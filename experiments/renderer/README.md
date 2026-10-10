# experiments/renderer

Dev-only study code for `docs/custom-renderer-study-2026-10-09.md`. **Nothing here is loaded by the
site** (`index.html` does not reference it, and nothing under `js/` was touched). Big binaries and
pictures are written OUTSIDE the repo, to `~/flyover-private/renderer-2026-10-09/` (set `RENDERER_OUT`
to move them).

The idea in one paragraph: take the real, built geometry of the authored apartment buildings out of the
running app once, draw it again with a purpose-built raw WebGL2 renderer (one vertex buffer, one index
buffer, one program, one multi-draw), and have a script that renders the app and the prototype from the
same ten cameras and reports how far apart the pictures are. That script is the safety net that would
make any bigger move safe, because it is fully automatic.

## Commands (from the repo root)

Setup, once: `cd scripts/verify && npm install` (playwright-core) and
`cd experiments/renderer && npm install` (meshoptimizer, only for the wire-size step).
Serve the repo on a port nobody else uses: `python3 scripts/serve.py 8475`.
Every browser run on the Mac goes through the one-browser queue:

```bash
GPU="node ~/Projects/astra-pipe/tools/gpu-run.mjs --label renderer --"
export PATH=~/miniforge3/envs/utx/bin:$PATH        # a recent node
export VERIFY_URL=http://127.0.0.1:8475            # default
# VERIFY_GL=hardware only when the owner is away; add RENDERER_NOVSYNC=1 for frame times

# 1. take the geometry out of the running app (about 2-4 minutes; writes apartments.bin/.json)
$GPU node experiments/renderer/dump-apartments.mjs

# 2. pack it (no browser): apartments.packed.bin/.json, the meshopt wire form, pack-report.json
node experiments/renderer/pack.mjs

# 3. what the frameworks cost today (arms: full, noslopes = ?slopes=0)
$GPU node experiments/renderer/measure-app.mjs --out measure-app.json

# 4. THE TEST. App vs prototype from the ten cameras in scripts/verify/ci/poses.json
$GPU node experiments/renderer/compare.mjs                            # app side + standalone prototype page
$GPU node experiments/renderer/compare.mjs --mode maplibre --phase proto   # same prototype as a MapLibre custom layer
$GPU node experiments/renderer/compare.mjs --break light --phase proto     # break it on purpose; the numbers must move
```

Other tools, none needs the GPU queue: `node experiments/renderer/selftest.mjs` (smoke test of the renderer and the image metrics in software GL),
`node experiments/renderer/measure-libs.mjs` (library bytes and parse time; needs `libs/` in the output folder: `curl` maplibre-gl@5.24.0,
three@0.159.0, pmtiles@3.0.6 from unpkg into `<out>/libs/`), `node experiments/renderer/summarize.mjs` (prints the markdown tables from the JSON),
`node experiments/renderer/compare.mjs --phase compare [--break light|quant|facet] [--mode maplibre]` (score existing pictures again). On the AWS
runner: `gh workflow run aws-gpu.yml --ref main -f ref=<branch> -f checks=renderer-bench.mjs` (the workflow runs only from `main`; `ref` is the branch to check).

`compare.mjs` writes, per view, `side-<view>.png` (app | prototype | moved pixels in magenta),
`diff-<view>.png`, and `result.json` with the numbers, under `compare-<tag>/`.

## Files

| file | what |
|---|---|
| `dump-apartments.mjs` | loads the app headless, waits for `slopesApartments.count.done`, POSTs every vertex/index/culling array to a local server that writes `apartments.bin` + `apartments.json` |
| `pack.mjs` | the app's arrays -> the 24-byte vertex format; position/size error; meshopt encode + decode time; gzip/brotli |
| `proto/renderer.js` | the renderer: one program, one VAO, a chunk table texture, CPU frustum culling, `WEBGL_multi_draw`, MapLibre custom-layer wrapper (`makeMapLibreLayer`) |
| `proto/standalone.html/.js` | the renderer on a page with no MapLibre and no three.js (time to first frame, bytes) |
| `proto/maplibre.html/.js` | the same renderer as a custom layer in a real MapLibre map (path A as it would be wired) |
| `measure-app.mjs` | GL calls per frame by phase (maplibre / three), layers by type, memory, library bytes, frame time, a V8 profile by file |
| `compare.mjs` + `lib/images.mjs` | the automated test: same camera, two renderers, per-view difference and a side-by-side picture |
| `selftest.mjs`, `measure-libs.mjs`, `summarize.mjs` | smoke test (no GPU), library bytes and parse time, markdown tables |
| `lib/app.mjs` | opens the real app with GL call counters installed before any app script runs |
| `scripts/verify/renderer-bench.mjs` | one entry that runs all of the above on the AWS GPU runner |

## What the comparison is, exactly

The app side is the real page with every other map layer and every other three.js group removed, the
background a flat `#ff00ff`, and the page flags `?sunlight=0&surfaces=0&facadefilter=0`: the BASE look,
which is MapLibre's own fill-extrusion lighting formula applied per vertex. The prototype ports that
look. It does **not** port sun shadows, glass reflection, the night window shading, the procedural wall
patterns, the surface detail, or the textured facade meshes; the study prices each one. The camera is
read off the app (`slopes.camera.projectionMatrix`, the light uniforms from the material) and handed to
the prototype, so the two cannot disagree about where the camera is.

Numbers per view: percent of pixels over tolerance 12/255 (whole frame, which is how
`scripts/verify/ci/pictures.mjs` counts, and over only the building pixels, which is the honest one
because the empty background dilutes the first), silhouette overlap (IoU), mean colour difference, SSIM
on 8x8 luma blocks.

Software GL (SwiftShader) is valid for pixels and for counting GL calls; it is not valid for frame
time. Every number the study prints says which it is.
