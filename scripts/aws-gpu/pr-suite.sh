#!/usr/bin/env bash
#
# pr-suite.sh - a pull request's whole check suite on ONE rented GPU machine: every check in
# scripts/verify/ci/checks.json, the before/after pictures, and a graphics probe. Called by user-data when the
# machine was started with --mode pr-suite (workflow "AWS PR checks"); it writes the SAME files the free GitHub
# run does, so scripts/verify/ci/summary.mjs turns them into the same report.
#
# Where it comes from: user-data takes THIS file from main, so the harness is main's and only the code under test
# (the checkout in $WORK, usually refs/pull/N/merge) is the pull request's.
#
# Inputs (exported by user-data): WORK OUT CHROME_WRAPPER CONCURRENCY BASE_PORT HEARTBEAT SUITE_ONLY WAIT_SCALE
# Optional: SUITE_SMOKE=1 skips the installs, the graphics probe and the pictures (the offline smoke test runs three
# pure-node checks through the same workers and report); SUITE_SHARDS overrides the shard count.
#
# What it writes under $OUT:
#   ci-out/results/shard-K.json   one row per check: verdict, exit code, seconds   (as the GitHub shards write)
#   ci-out/logs/<check>.log       everything each check printed
#   ci-out/pictures/<check>/...   every picture a check wrote
#   pictures/                     pictures.json + index.html + the side-by-sides
#   probe/gpu-probe.json          which graphics chip Chrome got, and how many frames a second
#   suite-meta.json               what was run, on what, how long
#
# THE TWO CHOICES THAT DIFFER FROM GITHUB'S RUN, both written down in the report:
#   * Graphics: VERIFY_GL=hardware (the L4). GitHub's run is software (SwiftShader), because ~100 checks assert
#     exact pixel colours and a real GPU and a software rasteriser disagree about edges. A check that is green
#     on GitHub and red here is therefore NOT automatically a bug: compare the two before trusting this lane.
#   * Waits: PW_WAIT_SCALE=$WAIT_SCALE (default 1: the checks' own waits). GitHub's machines use 3 because they
#     draw 0.2-0.4 frames a second.
set -uo pipefail

: "${WORK:?}" "${OUT:?}"
CONCURRENCY="${CONCURRENCY:-4}"
BASE_PORT="${BASE_PORT:-8442}"
HEARTBEAT="${HEARTBEAT:-/dev/null}"
SUITE_ONLY="${SUITE_ONLY:-}"
WAIT_SCALE="${WAIT_SCALE:-1}"
SMOKE="${SUITE_SMOKE:-0}"
beat() { touch "$HEARTBEAT" 2>/dev/null || true; }
now() { date +%s; }
T0=$(now)

cd "$WORK"
SHA=$(git rev-parse HEAD)
CI_OUT="$OUT/ci-out"
mkdir -p "$CI_OUT/results" "$CI_OUT/logs" "$OUT/pictures" "$OUT/probe"
export DEBIAN_FRONTEND=noninteractive

echo "== pr-suite: $SHA, up to $CONCURRENCY browsers at once, waits x$WAIT_SCALE =="
beat
if [ "$SMOKE" != "1" ]; then
  ( apt-get install -y -qq xvfb >/dev/null 2>&1 || true )   # headed checks need a display on Linux
  npm ci --prefix scripts/verify --no-audit --no-fund >/dev/null 2>&1 || npm install --prefix scripts/verify --no-audit --no-fund >/dev/null 2>&1
  python3 -m pip install --quiet shapely >/dev/null 2>&1 || true   # stadium-roof-filter measures with shapely
fi
beat

SHARDS="${SUITE_SHARDS:-$(node -p "require('./scripts/verify/ci/checks.json').shards || 1")}"
wrap=()
[ "$SMOKE" != "1" ] && command -v xvfb-run >/dev/null 2>&1 && wrap=(xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24")

# One tree and one page server per browser. hard links: no extra disk, and each worker's checks write their own
# new files, so the pictures a shard collects are its own (run-checks.mjs scans the checkout for new images).
tree_of() { if [ "$1" -eq 0 ]; then echo "$WORK"; else echo "${WORK}-w$1"; fi; }
for ((w = 1; w < CONCURRENCY; w++)); do rm -rf "${WORK}-w$w"; cp -al "$WORK" "${WORK}-w$w"; done
SERVERS=()
serve() {   # serve TREE PORT
  ( cd "$1" && exec python3 scripts/serve.py "$2" ) >"$OUT/serve-$2.log" 2>&1 &
  SERVERS+=($!)
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$2/index.html" && return 0; sleep 1; done
  echo "== the page server on $2 did not answer =="; return 1
}
cleanup() { for s in ${SERVERS[@]+"${SERVERS[@]}"}; do kill "$s" 2>/dev/null || true; done; }
trap cleanup EXIT

run_worker() {   # run_worker W
  local w="$1" tree port k
  trap cleanup RETURN   # this worker's own page server goes with it
  tree=$(tree_of "$w"); port=$((BASE_PORT + w))
  serve "$tree" "$port" || return 1
  local env_args=(VERIFY_URL="http://127.0.0.1:$port" PORT="$port" VERIFY_GL=hardware CHROME_PATH="$CHROME_WRAPPER")
  if [ "$WAIT_SCALE" != "1" ]; then env_args+=(PW_WAIT_SCALE="$WAIT_SCALE" PW_DEFAULT_TIMEOUT_MS=$((60000 * WAIT_SCALE))); fi
  if [ -n "$SUITE_ONLY" ]; then
    [ "$w" -eq 0 ] || return 0
    ( cd "$tree" && env "${env_args[@]}" ${wrap[@]+"${wrap[@]}"} node scripts/verify/ci/run-checks.mjs --only "$SUITE_ONLY" --out "$CI_OUT" ) \
      >"$OUT/worker-$w.log" 2>&1
    return 0
  fi
  for ((k = w; k < SHARDS; k += CONCURRENCY)); do
    beat
    echo "worker $w: shard $k"
    ( cd "$tree" && env "${env_args[@]}" ${wrap[@]+"${wrap[@]}"} node scripts/verify/ci/run-checks.mjs --shard "$k" --out "$CI_OUT" ) \
      >>"$OUT/worker-$w.log" 2>&1
    beat
  done
}

echo "== checks =="
T_CHECKS=$(now)
pids=()
for ((w = 0; w < CONCURRENCY; w++)); do run_worker "$w" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || true; done
cleanup; SERVERS=()
T_CHECKS_DONE=$(now)
echo "== checks done in $((T_CHECKS_DONE - T_CHECKS)) s =="
beat

# ---- a graphics probe: which chip did Chrome get, and how fast does the city draw ----------------------------------
[ "$SMOKE" != "1" ] && serve "$WORK" "$((BASE_PORT + 20))" && \
  ( cd "$WORK" && VERIFY_URL="http://127.0.0.1:$((BASE_PORT + 20))" CHROME_PATH="$CHROME_WRAPPER" \
      node scripts/verify/ci/gpu-probe.mjs --modes hw --out "$OUT/probe" ) >"$OUT/probe.log" 2>&1
cleanup; SERVERS=()
beat

# ---- the same views from the base and from this change: before, after, and before again (the noise floor) ----------
T_PIC=$(now)
BEFORE=""
if [ "$SMOKE" != "1" ] && [ -z "$SUITE_ONLY" ]; then
  if git rev-parse -q --verify HEAD^2 >/dev/null; then BEFORE=$(git rev-parse HEAD^1)    # a merge commit: its first parent is the base
  else git fetch -q --filter=blob:none origin main && BEFORE=$(git rev-parse FETCH_HEAD); fi
  echo "== pictures: before $BEFORE, after $SHA =="
  git worktree add -q --detach "${WORK}-before" "$BEFORE" 2>/dev/null || { git fetch -q --filter=blob:none origin "$BEFORE" && git worktree add -q --detach "${WORK}-before" "$BEFORE"; }
  ( cd "${WORK}-before" && npm ci --prefix scripts/verify --no-audit --no-fund >/dev/null 2>&1 ) || true
  serve "${WORK}-before" "$((BASE_PORT + 30))"; serve "${WORK}-before" "$((BASE_PORT + 31))"; serve "$WORK" "$((BASE_PORT + 32))"
  shoot() {   # shoot SIDE PORT REV
    ( cd "$WORK" && VERIFY_GL=hardware CHROME_PATH="$CHROME_WRAPPER" ${wrap[@]+"${wrap[@]}"} \
        node scripts/verify/ci/pictures.mjs --shoot "$1" --url "http://127.0.0.1:$2" --rev "$3" --out "$OUT/pictures" ) >"$OUT/shoot-$1.log" 2>&1
  }
  shoot before "$((BASE_PORT + 30))" "$BEFORE" & p1=$!
  shoot again "$((BASE_PORT + 31))" "$BEFORE" & p2=$!
  shoot after "$((BASE_PORT + 32))" "$SHA" & p3=$!
  wait "$p1" "$p2" "$p3" || true
  cleanup; SERVERS=()
  ( cd "$WORK" && node scripts/verify/ci/pictures.mjs --compare --label "${BEFORE_LABEL:-main}" --out "$OUT/pictures" ) >"$OUT/compare.log" 2>&1 || true
fi
T_END=$(now)

cat >"$OUT/suite-meta.json" <<JSON
{"sha":"$SHA","before":"$BEFORE","concurrency":$CONCURRENCY,"shards":$SHARDS,"wait_scale":"$WAIT_SCALE","gl":"hardware",
 "only":"$SUITE_ONLY","seconds":{"setup":$((T_CHECKS - T0)),"checks":$((T_CHECKS_DONE - T_CHECKS)),"pictures":$((T_END - T_PIC)),"total":$((T_END - T0))}}
JSON
echo "== pr-suite done in $((T_END - T0)) s (checks $((T_CHECKS_DONE - T_CHECKS)) s) =="
