#!/usr/bin/env bash
# Build the prototype wasm and put it in dist/. No npm, no wasm-bindgen, no wasm-pack: cargo + wasm-opt.
#
#   ./build.sh            build, optimise, write dist/meshkernel.wasm + dist/$NAME.wasm.sha256
#   ./build.sh --check    rebuild into a temp folder and fail (exit 1) if the bytes differ from the committed dist/ file
#
# Tools (no sudo, nothing outside one conda env):
#   ~/miniforge3/bin/conda create -y -n rustwasm -c conda-forge rust rust-std-wasm32-unknown-unknown binaryen
#   export PATH=~/miniforge3/envs/rustwasm/bin:$PATH
# Knobs: OPT=3 (default) or s | z, WASM_OPT_FLAGS (default -O3), SIMD=1 (adds wasm simd128; writes dist/meshkernel-simd.wasm)
set -euo pipefail
cd "$(dirname "$0")"
OPT="${OPT:-3}"; WOPT="${WASM_OPT_FLAGS:--O3}"; NAME=meshkernel; XF=""; XFEAT=""
if [ "${SIMD:-0}" = 1 ]; then NAME=meshkernel-simd; XF="-C target-feature=+simd128"; XFEAT="--enable-simd"; fi
out="dist"; [ "${1:-}" = "--check" ] && out="$(mktemp -d)"
command -v cargo >/dev/null || { echo "cargo not found: see the header of this file" >&2; exit 2; }
command -v wasm-opt >/dev/null || { echo "wasm-opt not found: see the header of this file" >&2; exit 2; }
# --remap-path-prefix keeps the build folder out of the binary, so two checkouts give the same bytes
RUSTFLAGS="--remap-path-prefix=$PWD=. --remap-path-prefix=$HOME=~ -C opt-level=$OPT $XF" \
  cargo build --release --locked --target wasm32-unknown-unknown --manifest-path rust/Cargo.toml 2>&1 | tail -3
raw=rust/target/wasm32-unknown-unknown/release/meshkernel.wasm
mkdir -p "$out"
# --strip-debug --strip-producers: no timestamps or tool versions in the output
# the features rustc 1.87+ turns on by default for wasm32-unknown-unknown (all shipped in every current browser)
FEATURES="--enable-bulk-memory --enable-bulk-memory-opt --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-multivalue --enable-reference-types"
wasm-opt $WOPT $FEATURES $XFEAT --strip-debug --strip-producers "$raw" -o "$out/$NAME.wasm"
sha=$(shasum -a 256 "$out/$NAME.wasm" | cut -d' ' -f1)
printf 'raw %s bytes -> wasm-opt %s %s bytes  sha256 %s\n' "$(wc -c <"$raw" | tr -d ' ')" "$WOPT" "$(wc -c <"$out/$NAME.wasm" | tr -d ' ')" "$sha"
if [ "${1:-}" = "--check" ]; then
  want=$(cut -d' ' -f1 dist/$NAME.wasm.sha256)
  if [ "$sha" = "$want" ]; then echo "OK: rebuilt wasm is byte-identical to the committed dist/$NAME.wasm"; else echo "DIFFERENT: committed $want, rebuilt $sha" >&2; exit 1; fi
else
  echo "$sha  $NAME.wasm" > dist/$NAME.wasm.sha256
fi
