# God's Eye View companion for Austin

A separate local viewer for aerial/terrain references and an offline panorama
projection tool. The city website keeps its existing renderer and dependencies.
See [the assessment](../../docs/gods-eye-view-assessment.md) for the useful parts,
known capture pitfalls, evidence rules and source terms.

## Start

From the Austin checkout, with Python 3 and supported Node (24.14+ in 24.x or 26.x):

```sh
python3 scripts/gods-eye/setup.py setup
python3 scripts/gods-eye/setup.py serve
```

Open `http://localhost:4174`. Ctrl-C stops the server. Installation goes to
`~/Projects/gods-eye-view`, pinned to the reviewed upstream revision. It keeps
upstream's notices and adds two exact dependency overrides for the advisories
found during review. It installs without lifecycle hooks or a second browser.
Reruns preserve source edits and refuse an unrelated or newer checkout.

The default route explicitly excludes provider credentials and uses Esri imagery
and keyless terrain. It has no photorealistic buildings. To enable optional
providers, configure them in the **separate companion's** environment/dotenv
and pass `serve --with-providers`. It never reads the macOS Keychain. Use a local
browser session for this companion; nothing here publishes it as an Austin site.

## Check

```sh
python3 scripts/gods-eye/setup.py doctor
python3 scripts/gods-eye/camera_test.py
python3 scripts/gods-eye/setup_test.py
python3 scripts/gods-eye/setup.py smoke
```

`smoke` uses existing Chrome/Edge (`CHROME_PATH` overrides discovery), starts its
own loopback server, verifies actual aerials, credits, camera restoration and
teardown, and closes both. It writes scratch captures and reports outside this
public checkout; `--out` selects another private folder. It uses software
rendering for correctness and makes no phone or frame-rate claim. Use one
browser slot at a time on this Mac.

## Use a panorama

Only rights-cleared equirectangular panoramas fit this tool's projection. It does
not calibrate arbitrary stitched phone pictures.

```sh
python3 scripts/gods-eye/setup.py tool pinhole -- \
  --input /private/path/panorama.jpg --heading 90 --pitch 0 --hfov 90
```

Output defaults outside Austin's repository. Preserve actual panorama heading,
date, field-level provenance and source terms in the private evidence store.
The wrapper deliberately offers only the verified offline tool. The upstream
Google acquisition/capture tools remain research references until their datum,
FOV, attribution and source-use limits are addressed.

## Compare a camera

Save the actual Austin `window.__fly.eye()` object to a private JSON file from
your browser session. Do not substitute `map.getCenter()`; that is a target.

```sh
python3 scripts/gods-eye/camera.py --eye /private/path/eye.json \
  --ground-ellipsoid 100 --map esri
```

`100` above is only a synthetic example. Supply a known WGS84 ellipsoidal height
for the authored model-ground anchor at that viewpoint. An orthometric height,
phone altitude or sampled roof is not interchangeable. The output link transfers
position/orientation only. It does not transfer FOV or establish a matched image.
See the assessment for the aspect-ratio conversion and an attribution-safe
reference workflow. Precise owner-photo locations stay private.
