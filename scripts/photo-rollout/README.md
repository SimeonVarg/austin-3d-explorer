# Photo rollout acceptance tools

These tools prepare a private photo-building run. They do not change the app,
draw a building, fit a camera, start a browser or spend API money. Keep using the
existing camera preflight, outline-fit and recipe comparison tools. This folder
adds the dependency check and the missing link between validated captures and
the pixels actually embedded in a comparison sheet.

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
