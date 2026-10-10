# rust-mesh: a prototype for "what can we rewrite in Rust"

It backs `docs/rust-study-2026-10-09.md` (read that first; it has the numbers, the research and the roadmap).

**Wired into the page behind a switch (roadmap step 1).** `https://.../?rustbuilder=1` makes the apartment builder use this module:
`js/slopes.js` imports `js/slopes-rust.js` and fetches `wasm/meshkernel.wasm` (a copy of `dist/meshkernel.wasm`, byte for byte, held
by `scripts/verify/wasm-mesh-parity.mjs`) only when the switch is on. With it off nothing new is requested. The check
`scripts/verify/wasm-mesh-parity.mjs` (no browser; runs in CI; `--break` must fail) proves the page's own `build()` and the Rust
builder make identical buffers. `scripts/verify/rust-builder-page.mjs` times the real page, switch off against on (laptop only).

**Packed output (`?rustbuilder=1&packverts=1`).** `lib.rs` `init_packed` makes the module write what the JS packed store writes: the exact float32
position and one 32-bit word per vertex, with the tone table (16 f32 a tone) and the normal table (4 f32 a normal) built inside the module
in first-encounter order (normals by the exact f32 bits, tones by the class `js/slopes.js` `toneKey()` gives their palette entry).
`js/slopes-rust.js` returns `position` + `aPack` as views of Wasm memory and copies the new table rows into the caller's tables object.
`scripts/verify/rust-packed-parity.mjs` (no browser; CI; `--break` must fail) holds it bit-identical to the JS packed store.
`profile/packed-end-to-end.mjs` runs the whole catalog through any of the four stores (JS or Rust, packed or not) and `profile/packed-bench.mjs`
times them interleaved.

What is here:

| Path | What |
|---|---|
| `rust/` | `meshkernel`: the shared mesh builder of `js/slopes.js` `build()` (tri / quad / triN / facet, flat normals, welded planar quads, byte colours, per-vertex surface) as a WebAssembly module with a flat C ABI, plus `blur_wrap` (an experiment: `js/pattern-lowpass.js` in Rust). 34 KB. No dependencies. |
| `dist/meshkernel.wasm`, `dist/meshkernel-simd.wasm` (+ `.sha256`) | the built, `wasm-opt`ed modules, committed so the site needs no build step (`SIMD=1 ./build.sh` makes the second). `../../wasm/meshkernel.wasm` is the copy the page fetches: `./build.sh` refreshes it, `./build.sh --check` also fails if the copy differs |
| `build.sh` | `cargo build` + `wasm-opt`; `./build.sh --check` rebuilds from scratch and fails if the bytes differ from the committed file |
| `js/builder-app.mjs` | the app's own `build()`, cut out of `js/slopes.js` at load time (not retyped), driven from a recorded stream |
| `js/builder-typed.mjs` | the same algorithm as tuned JS: typed array in, no per-call arrays. The honest competitor to the Rust. |
| `js/builder-wasm.mjs` | drives `meshkernel.wasm`: palette in, records in batches, zero-copy views out |
| `compare.mjs` | feeds one recorded stream to the app's builder, the tuned JS, the Rust module and the PAGE'S OWN ADAPTER (`js/slopes-rust.js`) and demands byte-identical buffers (sha256 of every attribute array); `--break` nudges every input, `--break-rust` only the Rust side's |
| `fixtures/moontower/` | 2 MB stream recorded from the real generator (Moontower alone), with the sha256 of what the real in-app builder produced |
| `blur/compare-and-bench.mjs` | the second kernel: `blur_wrap` against the app's `js/pattern-lowpass.js`, 408 byte-identical cases, then an interleaved benchmark (finding: no gain) |
| `profile/` | loads the REAL `js/slopes.js` + `js/slopes-apartments.js` into Node (no browser, no map) and runs the real build over the real 198-building catalog; records the builder stream; times the builder's share |
| `bench-one.mjs`, `bench-node.mjs` | interleaved Node benchmark, one fresh process per run (cold JIT like a page load) |
| `bench-browser.html`, `bench-browser.mjs` | the same in headless Chrome with real GL (through `gpu-run.mjs`) |
| `analysis/` | bytes-on-the-wire study (`pack-size.mjs`), the route search (`route-bench.mjs`), the bus protobuf (`protobuf-decode.mjs`) |
| `results/` | the raw JSON of the runs quoted in the study |

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
node bench-node.mjs /tmp/stream-full 9 > results/node.json
node analysis/pack-size.mjs /tmp/stream-full           # wire bytes: recipes vs baked meshes
node analysis/route-bench.mjs
# browser: one at a time on this Mac, through the lane gate
NOGPU=1 node bench-browser.mjs /tmp/stream-full 5 > results/browser.json        # CPU only: no GPU slot needed
NOGPU=1 node bench-browser-build.mjs 4 real,wasm,wasm-exact > results/browser-build.json   # whole generator in Chrome
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
