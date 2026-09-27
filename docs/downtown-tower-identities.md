# Downtown tower identities

The outer-ring bake now retains a building's public name when a curated height
record matches its footprint. That same match selects an authored skyline form;
it no longer changes only the height and leaves the tower anonymous.

`scripts/downtown_facade_profiles.py` assigns a facade recipe from known building
identity, use, available construction era, height, floor count and plan width.
Missing years remain unknown. Shared materials cover curtain wall, residential
slabs, punched hotel windows, stone offices, masonry streetwalls and parking.
`scripts/bake_outer_facades.py` stamps a stable profile ordinal (`fb`) onto both
`t=1` towers and `t=2` streetwalls. `js/outer.js` joins that ordinal to the existing
atlas painter. The palette has 17 materials sharing eight measured-grid estimates
and the existing parking family. The existing 16 campus families retain their
IDs; the registry uses 24 of its 36 available measured families. Lighting and
atlas repaint scheduling remain owned by their respective lanes.

`scripts/downtown_tower_identities.py` provides 23 distinct skyline forms:
Independent, Austonian, Frost, 360, Block 185, Modern, Natiivo, 70 Rainey,
Northshore, Seaholm, Colorado Tower, One American Center, 100 Congress,
JW Marriott, Fairmont, W Austin, Republic, ATX, 415 Colorado, 44 East, Paseo and
The Travis, plus Indeed Tower. The existing Waterline and Sixth
and Guadalupe geometry stays in `scripts/downtown_landmarks.py`. Glass bodies
use the shared atlas; only structural framing, slab edges, balcony recesses,
terraces and crowns add extrusion geometry. Independent has true balcony
trenches on both broad faces; Frost's crown folds taper in depth and width. There are no per-window meshes.
The complete outer layer adds approximately 76,800 closed-solid triangles before
tiling compared with the baseline. This conservative geometry estimate is not
a GPU or phone performance result.

Taste parameters live in the two new modules. Plan dimensions and facade grids
are architectural estimates guided by public photographs, not surveyed drawings.
Matched source footprints supply the podiums. Public height corrections remain
in `scripts/outer_heights.json`; three newly matched towers declare their public
position and height in the identity module. Photographs, source links and camera
poses remain local and are not part of the repository.

Normal regeneration uses `python scripts/bake_outer.py`, followed by
`python scripts/bake_outer_facades.py`, then the existing outer-layer invocation
in `scripts/tile.sh`. Geometry and palette must travel together: a newly stamped
palette with an old PMTiles file gives incorrect materials. Preserve z13-z16,
input order, extrusion buffers and the no-feature-drop settings when tiling.

Run `python scripts/verify/downtown-data.py` for baked height, structural contact,
profile-join and stale-ID checks. These checks do not establish visual acceptance.
Thirty matched real-app comparisons are packaged locally: 25 reference/tower
triptychs, campus skyline day/night, aerial, and street day/night. All actual
app poses match, sources and outputs are hashed, and final JPEGs are below 1 MB.
Reference viewpoints are approximate rather than calibrated. Captures use the
second settled screenshot and report no page or console errors.

Three fresh-browser interleaved AMD Radeon pairs used `--force_low_power_gpu`,
1440x900 DPR 1, balanced, CPU 1x, cancelled auto-detect and six-second continuous
render samples at one verified aerial pose. Minimum p50 frame times were
38.0 -> 16.8 ms by day and 66.2 -> 17.5 ms at night; minimum p95 was
87.9 -> 73.7 ms by day and 172.5 -> 54.9 ms at night. The prescribed minimum
comparison shows no regression. Variability remains large: night samples ranged
10.1-14.1 FPS before and 11.1-34.1 after, with one paired night run slower.
These short samples do not establish consistent speedup, motion stability,
or physical-phone performance. Reviewer acceptance and normal-pipeline retile
inspection remain required before release.

Known limits: a separate parking-class footprint near Natiivo retains its
raw 98.3 m source height; that suspicious height needs footprint-specific
evidence before correction. Austonian's crown, Seaholm's facade and the
stepped gables of 100 Congress still need closer reference matching. W Austin's
pale blades and recess contrast, Natiivo's material variation, and the vertical
ribbons on 360, 44 East and Travis remain weaker than their references. Some
podiums are obscured in the tower comparisons, especially Indeed and Paseo;
those frames establish their upper forms, not complete podium accuracy.
Other limits: narrow distant mullions remain bounded by the existing atlas;
public night coverage is incomplete, so most crowns use restrained neutral
lighting. Fairmont's blue crown has explicit photographic support. Its special
window-heart display is not an everyday default. Paseo roof lettering and staggered podium slots and ATX inclined transfer
columns remain simplified. Paseo's 48 floors are publicly confirmed; its 172.8 m
height remains the existing inventory value without a direct source confirmation.
Street-level signs, retail interiors and landscaping are not authored by this
tower pass. Physical-phone
thermal, memory and performance behavior remains unverified.
