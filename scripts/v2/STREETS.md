# Street geometry checks

The City point inventories are observations, not safe render positions. Rebuild in this order:

```sh
python3 scripts/v2/street_fetch.py /path/to/city-cache
python3 scripts/v2/street_near.py /path/to/city-cache /path/to/aerial-cache
python3 scripts/v2/street_graph.py /path/to/city-cache /path/to/aerial-cache
python3 scripts/v2/street_safety.py
python3 scripts/v2/street_check.py --output /tmp/street-checks.json
```

Keep an unchanged copy of `v2/data/street/*.json` outside the repo before editing. Pass that folder with `street_check.py --before /path/to/copy` for before/after counts. `street_bake.py` produces the raw signal and OSM furniture inputs; rerun it when its source cache changes.

`safe.json` contains the City sign posts and signals. `safe_osm.json` contains OSM furniture and arrows derived using OSM lane-use tags, with its ODbL notice. The loaders fail closed if a safe file is absent. Do not restore raw poles/arrows as a fetch fallback.

Every pole's footing must fit on a surveyed/modelled sidewalk with clearance from the complete road union. Snap by at most 8 m; drop if there is no supported location. A point outside the carriageway alone is insufficient. Shelters and seats also need room for their complete footprints. Light arms point toward the road; their bearings are inferred.

An arrow needs an explicit matching `turn:lanes` declaration, lane counts for its direction, plausible measured lane widths, painted internal dividers, a nearby junction in front of it, and directed outgoing road connections for every indicated turn. Drop ambiguous or unsupported records, including U-turn and multi-turn shapes the renderer cannot represent. A road centreline or the nearer end of a block is insufficient. The lane-use declaration supplies permission; connectivity supplies the physical exit. This remains a conservative reconstruction from dated public data, not a survey of current traffic rules.

Small enclosed holes in the road union are flagged across the whole area. Do not invent raised frontage inside them or a sidewalk ring along a service aisle. Keep the surveyed walks and the off-road aerial. Warning pads must fit behind the kerb on a sidewalk. Polygon coordinates must stay valid after the 5 cm output quantization.

Asphalt is opaque at every distance and camera height, in one shared draw. Fine details keep their existing distance limits. Adding coverage must not expose the aerial road again or create one draw per road.

`street_check.py` audits all baked roads, polygons, poles, symbols and warning pads. `street-loader-check.mjs` builds the actual Three.js geometry without a GPU and verifies permanent asphalt and draw counts. Neither establishes a physical phone frame rate or visual acceptance. The publisher still checks the four requested views twice in the browser, plus slow pans and the opening flight, and measures phone performance separately.

Round-two checks (October 19):

- Treat every trunk footprint, from both tree sources, as an obstacle. Filter against the final quantized asphalt, preserving actual holes/medians. `street_tree_safety.py` writes `v2/data/trees/safe_city.json` and `safe_osm.json`; raw observations remain untouched. Both filtered selections carry an ODbL notice because placement uses the OSM-derived road surface. The tree loader uses only these files. Rebuild them after the surface changes.
- Union raised ground BEFORE deciding attachment; a tile seam is not a disconnected sidewalk. Drop frontage components detached by more than 15 cm from sidewalks, plus detached sidewalk fragments under 4 m². Aerial-classified frontage is ground level, not an elevated slab. Fully faded structural fragments must discard before writing depth.
- Check lane alignment to one road throughout the line (five samples, 2 degrees and 25 cm transverse-drift tolerances). Drop unproven lines. Remove overlapping white detections within 35 cm; preserve yellow pairs. Inspect lengths and junction exclusions as well. Perspective makes parallel world lines converge: compare world bearings before 'correcting' a photographed fan.
- Check actual rendered signal-head geometry for all instances: approximately 1.1 m body height and at least 4.6 m road clearance. Three 12-inch, unlit lenses identify a signal without inventing its phase. The round-one body already passed the physical size/clearance check; a browser must still decide whether the apparent black posts have been resolved. The source does not establish surveyed mast spans, head orientation or phase. Basis: [FHWA MUTCD 4D.15](https://mutcd.fhwa.dot.gov/htm/2009/part4/part4d.htm#section4D15).
- Every displayed panel needs an identified legend. `street_signs.py CITY_CACHE --font /path/to/Roboto.ttf` joins the same City asset groups/order as the original bake, checks kinds and coordinates, then builds `sign_faces.json` and `sign_glyphs.png`. Unidentified panels, and posts whose entire stack is unidentified, are omitted. Retain the font's `sign-font-OFL.txt`. Roboto is an approximation of highway lettering; recorded NO PARKING symbols are rendered as a schematic textual legend. Bus markers say BUS from the OSM stop classification, with no invented operator or route.
- Use one shared signed-distance glyph atlas and the existing spatial street buckets. Derivative antialiasing applies at glyph edges; no scene blur, camera/label change or building LOD change. Check sign stacks against 2.1 m sidewalk clearance, including multi-panel stacks, and make each post reach its upper panel. Yield text must fit inside the narrowing triangle.

Rebuild order after `street_graph.py`: `street_safety.py`, `street_tree_safety.py`, then `street_signs.py`. The graph calls `street_finish.finish` automatically. To apply that final step to existing graph outputs without refetching, use `street_finish.py --existing --audit /tmp/finish.json` once, then rebuild the dependent inventories. Keep sibling `street/` and `trees/` baseline folders for the before/after audit.

Run `street_check.py`, `street-loader-check.mjs`, `street-loader-check.mjs --missing-safe` and `--missing-signs`. The CPU loader substitutes a PNG-header-checked texture for the browser image only in the harness. Its geometry, clearance and draw checks do not validate shader compilation, browser appearance, motion or phone fps. Browser checks must include the original three views twice, other junctions, slow pans, and actual device timing. Never describe a geometry diagnostic or the atlas image as an application screenshot.
