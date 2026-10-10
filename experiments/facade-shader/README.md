# experiments/facade-shader

Dev-only study code for `docs/graphics-basics-study-2026-10-10.md`. **Nothing here is loaded by the site** (`index.html` does not
reference it and nothing under `js/` was touched). The one file outside this folder is the runner entry
`scripts/verify/facade-shader-bench.mjs`, which the AWS GPU workflow needs to find under `scripts/verify`.

The idea in one paragraph: the app draws a window wall as 400 to 500 small quads per wall (the cell tiler in
`js/slopes-apartments.js`). A wall is also, exactly, a rule: a bay width, a window size, a sill, a floor pitch. This folder draws
ONE real authored tower (Dobie Twenty21, 45,585 triangles, a pure window wall) twice from the same cameras: as the app's own
triangles, and as 98 flat quads with a fragment shader that computes the windows from the recipe's numbers, box-filtered over each
pixel's footprint so it cannot alias, with the recess of each window done as an exact parallax shift. Then it scores both.

## Commands (from the repo root)

```bash
export PATH=~/miniforge3/envs/utx/bin:$PATH      # any Node 20+

# 0. no GPU, no browser, no dump needed: these read the fixture
node experiments/facade-shader/verify-recipe.mjs   # recipe numbers -> window rectangles == the app's glass cells, on every wall
node experiments/facade-shader/selftest.mjs        # the shader's own cum()/cov() text, run as JS, against brute-force sampling

# 1. (only to rebuild the fixture) needs the renderer study's dump of the running app:
#    node experiments/renderer/dump-apartments.mjs, then
node experiments/facade-shader/extract.mjs

# 2. THE BROWSER RUNS. On a real GPU only: use the AWS runner, never a shared laptop chip.
~/.local/bin/gh workflow run aws-gpu.yml --ref main -f ref=<branch> -f checks=facade-shader-bench.mjs -f max_runtime=40
#    or on a quiet machine with a real GPU and the repo served at VERIFY_URL:
VERIFY_GL=hardware VERIFY_OUT=/tmp/fs node experiments/facade-shader/run.mjs      # lab: arm A against arm B
VERIFY_GL=hardware VERIFY_OUT=/tmp/fs node experiments/facade-shader/probe.mjs    # what limits THIS chip
```

## Files

| file | what |
|---|---|
| `fixture/dobie-twenty21.*` | 0.44 MB in all: the tower's window-wall triangles in the study's 24-byte vertex (`.facade.bin.gz`), its podium and crown (`.rest.bin.gz`), and `.json` (98 wall rectangles, the recipe's pattern numbers, the three tone triples, the light uniforms read off the real app) |
| `extract.mjs` | takes the tower out of the renderer study's dump of the app's own arrays; finds the walls as the planes holding field-coloured vertical triangles; measures the generator's horizontal scale |
| `lib/pattern.mjs` | the window rule in JavaScript (`windowsFor`) and the closed-form box integral (`cum1D`, `coverage`) |
| `verify-recipe.mjs` | the correctness test of the idea: 2,328 windows predicted from the recipe against 2,328 glass cells in the geometry |
| `selftest.mjs` | takes the GLSL `cum`/`cov` out of `page/lab.js` as text, runs them as JS, checks them against brute-force sampling |
| `page/lab.js`, `page/index.html` | the lab: arm A (geometry), arm B (shader), the moire-meter method, overdraw counting, simulated TAA, frame times |
| `page/probe.html`, `probe.mjs` | the chip probe: triangle rate, small-triangle rate, vertex work, vertex bytes, fill rate, shader work per pixel |
| `run.mjs` | drives the lab in Chrome and writes `result.json` and one picture per view |
| `../../scripts/verify/facade-shader-bench.mjs` | the AWS runner entry |

## Honest limits of the fixture

- The wall rectangles are found in the geometry, not computed from the footprint ring: the prototype tests the SHADER against the
  geometry. A production bake would take them from the ring (`wallFrame` in the generator).
- Daylight and golden light only. The night windows (a lit/unlit room per window, a hash) are not ported: that is a per-cell hash in the same
  shader (listed in the roadmap), and the metrics here do not include night.
- One skin kind (`bays`, one window per bay per floor, uniform floor pitch). `mod4` (Union on 24th), `pixel` (The Standard) and the strip/pier/
  louvre options are each a few more lines of the same kind; they are priced in the study, not built.
