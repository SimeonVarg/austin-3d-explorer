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
