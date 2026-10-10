#!/usr/bin/env bash
# wasm size for each (rustc opt-level, wasm-opt flag) pair: raw rustc output, after wasm-opt, gzip -9, brotli -q 11.
# Builds into a temp dir; leaves dist/ alone.
set -euo pipefail
cd "$(dirname "$0")"
FEATURES="--enable-bulk-memory --enable-bulk-memory-opt --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-multivalue --enable-reference-types"
printf '%-9s %-8s %9s %9s %9s %9s\n' opt-level wasm-opt raw wasm-opt gzip-9 brotli-11
for opt in 3 s z; do
  RUSTFLAGS="--remap-path-prefix=$PWD=. -C opt-level=$opt" CARGO_TARGET_DIR="$(mktemp -d)" cargo build --release --locked --target wasm32-unknown-unknown --manifest-path rust/Cargo.toml -q
done 2>/dev/null || true
for opt in 3 s z; do
  T="$(mktemp -d)"
  RUSTFLAGS="--remap-path-prefix=$PWD=. -C opt-level=$opt" CARGO_TARGET_DIR="$T" cargo build --release --locked --target wasm32-unknown-unknown --manifest-path rust/Cargo.toml -q
  raw="$T/wasm32-unknown-unknown/release/meshkernel.wasm"
  for w in -O3 -Oz; do
    wasm-opt $w $FEATURES --strip-debug --strip-producers "$raw" -o "$T/o.wasm"
    printf '%-9s %-8s %9s %9s %9s %9s\n' "$opt" "$w" "$(wc -c <"$raw" | tr -d ' ')" "$(wc -c <"$T/o.wasm" | tr -d ' ')" "$(gzip -9 -c "$T/o.wasm" | wc -c | tr -d ' ')" "$(python3 -c "import brotli,sys;print(len(brotli.compress(open('$T/o.wasm','rb').read(),quality=11)))" 2>/dev/null || ~/miniforge3/envs/utx/bin/node -e "const z=require('zlib');console.log(z.brotliCompressSync(require('fs').readFileSync('$T/o.wasm'),{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}).length)")"
  done
  rm -rf "$T"
done
