# Photo rollout tools

These tools inventory private photo evidence, prepare reviewed inputs, generate
bounded detail trials, and check camera/capture consistency. They extend the
existing fitter and renderer with explicit physical, projection and receipt
checks. Capture still uses the existing browser machinery; these tools do not
publish city geometry or spend API money. Source photos, cameras, candidates and
comparison artifacts stay outside Git.

## Python setup

Prefer a working external environment. This command checks exact versions,
package consistency, OpenCV mask drawing, Pillow PNG roundtrip, polygon
subtraction and the EPSG:6578 US survey foot coordinate roundtrip. It changes
nothing in the supplied environment:

```sh
python3 scripts/photo-rollout/setup.py --reuse-python /private/runtime/bin/python
```

If no compatible environment exists, use the bundled Python to install binary
wheels into an isolated, version-keyed environment under
`~/.local/share/flyover/photo-rollout/`. Python 3.9 reuse and Python 3.12 install
are verified locally; other interpreter/platform combinations need compatible
wheels and a successful smoke check. The installer never compiles a package.

```sh
/path/to/bundled/python3 scripts/photo-rollout/setup.py
/path/to/bundled/python3 scripts/photo-rollout/setup.py --check
```

The printed `python_executable` is the interpreter to use below. `--offline`
disables index access; `--wheelhouse /private/wheels` supplies local wheels.
Existing unrecognized directories and runtime paths inside Git checkouts are
refused. There is no system install, repo venv or automatic upgrade of an old
environment. `--reuse-python` does not fall back to installation if it fails.

The pins in `requirements.txt` are exercised by the local tooling: NumPy and
OpenCV support outline/mask operations; Pillow reads images and writes sheets;
Shapely handles polygon subtraction; pyproj matches the survey conversion in
`scripts/lidar_raster.py`. `certifi` is pyproj's dependency. Font export and
optimization libraries are omitted until a concrete operation needs them.
Coordinate smoke tests disable PROJ network access and do not establish an
accurate vertical datum or download a geoid grid.

## Capture, validate, then build sheets

Use fresh render and mask output paths for every attempt. Never adopt an older
output by touching it. All JSON receipts and sheets must be outside Git
checkouts: they contain private paths and camera identifiers.

1. Save the exact camera and drawing settings as JSON files. Settings must have
   an explicit boolean `trees` field. Include every rendering flag that could
   affect the comparison, such as daylight hour, shadows, hidden neighbours,
   renderer version and canvas size. Put actual page readbacks in the camera or
   settings evidence when the existing capture harness provides them.
2. Snapshot the inputs **before** invoking the existing renderer:

   ```sh
   "$PHOTO_PYTHON" scripts/photo-rollout/accept.py begin \
     --recipe /private/run/candidate.json --camera /private/run/view-a-camera.json \
     --camera-tag view-a --settings /private/run/daylight.json \
     --out /private/run/after-inputs.json
   ```

3. Render using those exact inputs. Produce a single-channel target-building
   mask from the same capture: white is the building, black is everything else.
   Provide a dedicated same-camera building-mask pass, not a bounding box or a
   coverage number. The prior private capture harness has a scene volume-mask
   option; its building-specific bounds and native occlusion limitations need
   inspection before reuse. RGB masks must be explicitly converted to grayscale
   and saved as single-channel PNG before sealing. Then seal the output:

   ```sh
   "$PHOTO_PYTHON" scripts/photo-rollout/accept.py seal \
     --inputs /private/run/after-inputs.json --frame /private/run/after.png \
     --mask /private/run/after-mask.png --out /private/run/after-capture.json
   ```

   This rejects changed inputs, outputs older than the snapshot, mismatched
   mask sizes, unapplied image orientation, transparent frames, target coverage
   of 1% or less and frames over 97% one RGB colour bin. RGB bins are eight
   levels wide so tiny compression/noise variations do not validate a flat
   sky-only frame. Mask values above 127 count as target pixels.
4. Repeat for baseline `before` and candidate `trees_off`. The latter changes
   only `trees` to false. Save separate settings files; do not overwrite inputs
   used by a sealed capture.
5. Create a plan using the example below and accept it:

   ```sh
   "$PHOTO_PYTHON" scripts/photo-rollout/accept.py accept \
     --plan /private/run/plan.json --out /private/run/manifest.json
   "$PHOTO_PYTHON" scripts/photo-rollout/accept.py sheets \
     --manifest /private/run/manifest.json --out-dir /private/run/pairs
   "$PHOTO_PYTHON" scripts/photo-rollout/accept.py verify \
     --sheets /private/run/pairs/sheets.json
   ```

The plan binds baseline and candidate recipe hashes, each panel's camera hash
and tag, drawing settings, mask and render. All four panels must have identical
pixel dimensions. An optional integer `crop: [left, top, right, bottom]` applies
to every panel and is checked again for target coverage and flat colour.

Sheets contain `photo | before | after | trees off`. CHECK cameras remain
labelled `CAMERA NOT PROVEN`. PNG output preserves panel pixels exactly. The
final verifier compares each embedded panel to its accepted source pixels;
changing a sheet hash cannot hide a stale embedded panel. Build checkpoint
sheets with the same flow using the recipe from that checkpoint. Independently
verify before showing any sheets, and open every sheet yourself.

```json
{
  "schema": 1,
  "before_recipe": "/private/run/baseline.json",
  "after_recipe": "/private/run/candidate.json",
  "sheets": {
    "view-a": {
      "status": "PASS",
      "camera_file": "/private/run/view-a-camera.json",
      "settings_file": "/private/run/daylight.json",
      "photo": "/private/run/view-a.jpg",
      "before": "/private/run/before-capture.json",
      "after": "/private/run/after-capture.json",
      "trees_off": "/private/run/trees-off-capture.json"
    }
  }
}
```

## What a pass proves

The tool catches accidental file reuse and inconsistent comparisons; it does
not score likeness, prove a camera, establish that the chosen baseline is
current main, or prove that a capture harness obeyed the declared inputs.
Capture timestamps are a local freshness guard, not provenance attestation.
A wrong target mask, undeclared renderer setting or forged receipt can still
mislead it. A nearly uniform image straddling a quantization boundary can pass
the colour check. Opening every sheet, normal app-camera preflight and checking
all four building sides remain required. Existing legacy manifests lack the
capture receipts; rerender rather than retroactively claiming they are sealed.

Run the synthetic acceptance and runtime boundary checks in the verified
runtime; no real photo, browser, server or network access is needed:

```sh
PYTHONDONTWRITEBYTECODE=1 "$PHOTO_PYTHON" -m unittest discover \
  -s scripts/photo-rollout -p 'test_*.py' -v
```

## Whole-library coverage and reviewed inputs

`catalog.py` joins the existing walk metadata, private ray index and visual
confirmations, per-building `sources.json`, and the library manifest. It inventories
all local image files and hashes exact-byte copies. Missing location, missing
images and unassigned files remain explicit. Unassigned files can include working
images and contact sheets: their count is **not** a count of missing original
photographs. Different encodings are not deduplicated as one photograph. Existing
walk records join their known thumbnail/full-size derivatives. Known symlinks keep
both logical source paths and resolved provenance; a manifest cannot expand the
inventory outside the supplied source tree.

```sh
"$PHOTO_PYTHON" scripts/photo-rollout/catalog.py build \
  --root /private/references --index /private/existing-photo-index \
  --out /private/run/catalog.json
"$PHOTO_PYTHON" scripts/photo-rollout/catalog.py packet \
  --catalog /private/run/catalog.json --plan /private/run/selection.json \
  --out /private/run/packet
```

A selection has `views`, each with `file`, `reviewed: true`, `role` (`build` or
`holdout`), an explicit `viewpoint_group`, `categories` drawn from `building`,
`ground`, `decoration`, and `observation`/`uncertainty`. Optional `crop` is an
integer box in orientation-normalized source pixels. The packet retains source
hashes and produces orientation-normalized JPEGs without source metadata. It
rejects changed sources, shared build/holdout viewpoint groups, duplicate bytes,
known shared originals, and overwriting an earlier packet. Reviewers must establish
identity and viewpoint groups; the tool does not infer them. A photograph of
another facade does not validate an invisible feature. Record corroboration per
feature, including “not independently visible.” Packet receipts and images stay
private. These tools do not call a model or incur API charges.

## Bounded detail trials

`detail.py` produces an additive candidate in the existing building recipe format.
It reuses the existing author's closed geometric primitives for a clipped-corner
picnic table with connected tubular supports, a wall diamond, and a convex ground
surface inset. Every shape/dimension comes from an explicit private specification.
This is a small component trial, not a general reconstruction system.

```sh
"$PHOTO_PYTHON" scripts/photo-rollout/detail.py \
  --recipe /private/run/baseline.json --spec /private/run/features.json \
  --out /private/run/candidate.json
```

The specification requires `pose_evidence`, the private input JSON described below.
The generator runs that check itself, refuses `REJECT`, and binds the evidence hash
and check result into its receipt. `CHECK` creates an exploratory candidate only.
It also has a unique `prefix` ending in `-`, `tones` in the recipe's
`colours` form (for example `{"trialMetal":{"hex":"#35544c"}}`), `materials`,
and `features`. Each feature has an `id`, `kind`, `tone`, explicit geometry values,
and `_src` evidence. See the synthetic fixture in `test_detail.py` for the parameter
shape. Place observed shape/count and inferred dimensions, hidden connections and
placement in separate field-level source entries; keep original source identities
private. Existing colour/material keys cannot change. Existing blocks and meshes
are retained, and duplicate generated IDs are rejected. Always regenerate from
the frozen baseline. A ground inset adds a thin surface; it does not excavate the
retained slab. Table perforations and hidden fabrication details are not modeled.

The receipt records hashes and added triangle count. Inspect the candidate in the
real city from the source-facing and opposite views before any publication. Tests
check closed nondegenerate geometry and retention, not resemblance. Building masks
in `accept.py` do not establish furniture, soil-boundary or whole-scene accuracy.

## Physical camera preflight

A low image-fitting error can still put the camera underground. `pose_check.py`
checks that failure separately from reprojection quality:

```sh
"$PHOTO_PYTHON" scripts/photo-rollout/pose_check.py \
  --pose /private/run/pose-evidence.json --out /private/run/pose-check.json
```

Supply local `camera: [x,y,z]`, `ground_z` at that point (or `null`),
`ground_source`, `ground_support` (`independent` or `model`), optional
`height_range: [minimum,maximum]` above that plane, `height_support` (`observed`
or `assumed`), `mean_error_px`, `heldout_error_px`, and an explicit
`error_limit_px`. No universal error threshold is assumed. A camera at or below
that ground plane is `REJECT` even with tiny residuals. Modeled ground or assumed
capture-height bounds remain `CHECK`; only independently supported inputs can
be `SUPPORTED`. That status still does not prove building identity, metric scale,
or hidden geometry. A rejected receipt exits nonzero; inspect `status` for all
other cases rather than equating exit success with a proven camera.

To convert a supported or CHECK local camera into an application view, add
`local_angles: {"yaw":0,"pitch":0,"roll":0,"hfov":60}` to that evidence and
supply `--recipe /private/run/baseline.json --view-out /private/run/app-view.json`.
The adapter uses the recipe's stored `frame.obb` exactly and binds the recipe and
emitted view hashes to the preflight receipt. The view explicitly carries
`camera_math_version: 2`: use a renderer that recognizes this version and applies
the corrected frustum and Mercator placement. Preserve this field when placing the
view in a job; do not route it through a consumer that drops version metadata or
relabel an approved legacy pose as version 2. It refuses implicit frames; use the
existing camera fitter to resolve those rather than guessing another bounding box.
A rejected pose emits no application view. This guards the quarter-turn error from
recomputing an already-authored frame from the footprint's longer side.

Before using an existing photo-camera renderer, run its frustum helper through:

```sh
node scripts/photo-rollout/check-frustum.mjs /private/renderer/camera.mjs
```

The check samples the full image across ten upward/downward/rolled camera cases.
A helper must either contain the image or declare clipping. It catches the older
symmetric-frame calculation that used only the upper extent and silently lost
lower ground/furniture pixels for downward views. Correct both existing JavaScript
and Python twins to use the maximum absolute vertical extent; the checker does
not patch another tool. A clipped view remains unsuitable for a complete comparison.

When the pose contains an OpenCV world-to-camera `R` matrix, the adapter derives
yaw, pitch and roll from that matrix and uses only `hfov` from `local_angles`.
This is explicit in the emitted `angle_source`. OpenCV rows are right/down/forward;
the photo renderer's roll is **minus** `atan2(right.z, up.z)`. Copying the older
fitter's reported roll reverses that rotation. A proper rotation is required;
a reflection, non-orthonormal matrix or vertical optical axis is rejected.

## Find candidate overlap before reserving a holdout

`overlap.py` checks a bounded explicit set of 2–12 images on one CPU thread:

```sh
"$PHOTO_PYTHON" scripts/photo-rollout/overlap.py \
  --plan /private/run/overlap-plan.json --out /private/run/new-overlap-output
```

The plan is `{"views":[{"id":"front","file":"/private/front.jpg"},
{"id":"side","file":"/private/side.jpg"}]}`. Relative paths are relative to
that plan. Existing building groups can supply these small sets; missing GPS and
assignment remain unknown. The matcher normalizes orientation, rejects duplicate
bytes/pixels, checks mutual feature matches, two-way planar errors, spatial spread
and repeated half-fits. Results and a correspondence sheet stay private, bound to
the input hashes. Inspect recognizable physical landmarks in every proposed pair.
Repeated windows can support a coherent wrong plane even when every numerical
check passes. A shortlist is not proof of object identity, calibration, metric
scale or withheld-view accuracy. The half-fits withhold selected correspondences,
not independent photographs. The tool never marks a packet visually reviewed.

Use `camera-placement.mjs` when placing a near-horizontal MapLibre camera. Its
`placement({eye, scale, h, yaw, pitch, fs})` takes the eye in Mercator coordinates,
the **scene origin's** Mercator units per local metre, height in scene units,
compass yaw, MapLibre pitch and planned focal length in pixels. It returns a
Mercator center and zoom. Convert that center with `MercatorCoordinate.toLngLat`.
Approximating latitude with metres/110540 can displace a low eye by tens of
centimetres at pitch 88, despite unchanged reported height/yaw. Run
`node scripts/photo-rollout/test-camera-placement.mjs` for the inverse placement
regression. Physical source-camera support still requires the preflight above.


After capture, check actual point projections across multiple depths and heights:

```sh
"$PHOTO_PYTHON" scripts/photo-rollout/projection_check.py \
  --pose /private/run/projection-pose.json --plan /private/run/capture.plan.json \
  --projection /private/run/app-projections.json --limit-px 1 \
  --out /private/run/projection-check.json
```

The pose contains `camera`, OpenCV world-to-camera `R`, intrinsic `K`, and
`image_size: [width,height]`. The renderer plan contains `outW`, `outH`, `cx`,
`cy`, `fs`, `fp`, `enginePitch`, and photo `pose` angles. The app snapshot is
`{"points":[{"name":"ground","xyz":[u,v,z],"engine":{"x":123,"y":456}},...]}`:
project each point with `slopes.project` after converting through the same recipe
frame used to build it. Use at least four points spanning three dimensions;
a single wall plane is insufficient for this check. Snapshot the actual rendered
camera, not a separate ideal camera. `CONSISTENT` means the fitter-to-app-to-warp
math agrees within the explicit pixel tolerance. It does not prove the source
camera, metric scale, ground elevation, object identity or model likeness.
The output binds all three input hashes. A mismatch exits nonzero and must not
be described as a source-aligned comparison. Keep earlier captures as diagnostics.
