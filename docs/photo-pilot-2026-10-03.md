# Photo pilot — October 3, 2026

Branch: `codex/campus-photo-pilot`. The owner authorized a connected engineering
trial and a P Terry’s transfer test, followed by a request for more faithful
vector lettering at equal or lower cost. Private candidates and comparison
frames are outside the repository. No accepted city geometry is replaced.

Cockrell’s generic 24 m snapshot prism conflicts with eleven listed floors.
A cropped USGS 2017 point cloud places the west plaza near 172 m, the lower
roof near 214 m and the penthouse near 217 m. The full-footprint ground median
is about 165 m because the site includes a substantial drop. Ground around
the site must be modeled locally; subtracting that median from every roof
would exaggerate the west facade. Nine entrance risers are visible. The
count is photo-supported; total rise, tread and rail dimensions remain estimates.

Private trials use the existing apartment recipe and detail-mesh formats.
P Terry’s receives a comparison of existing fixture lighting at identical
cameras, without changing shared renderer ownership. Exact illuminated vector
signs need support in `outlineSign`, which currently ignores the light field.
That renderer change belongs to the Acer lane and also overlaps open PR #312.
Do not modify it here.

The lettering trial stores unique serif glyph outlines once, places repeated
letters by advance, and expands to the existing outline format for rendering.
Matched whole-scene builds reduce lettering by 1,099 triangles: 6,021 versus
7,120 for block lettering, about 15.4%. Both retained second screenshots have
no page errors or missing glyphs. This is a geometry count, not an FPS result.

The library and two placements total 12,811 raw bytes / 4,184 gzip bytes. The
complete private recipe is 9,132 bytes gzip versus 4,808 bytes for the matching
pixel control, so download size grows by about 4.3 KB. Shared contours can be
reused across later inscriptions. The exact photographed lettering should be
traced or matched to a properly licensed font before claiming exact identity.
Font files are not redistributed. Private candidates, camera plans and retained
comparisons were copied to the Acer private evidence store and hash-verified.

HANDOFF.md overlaps other open PRs (#348, #312, #307, #189, #164); this separate
pass record avoids writing over their lane work. The old Mac queue names only
DKR, so new photo candidates remain private until an explicit bake/output
ownership addition or Acer integration.

## Scalable lettering decision and Cockrell refinement

Use shared glyph contours and cached triangulation for ordinary text, keyed by
font/asset identity and contour version. Preserve whole-sign contours for logos,
joined script and distinctive wordmarks; one generic alphabet must not replace
checked typography. Append transformed geometry to the existing building buffers
rather than making one mesh per letter. Keep inline outlines and bitmap records
compatible. Verify lighting, vertical layout and backing-strip behavior before
conversion: the current outline renderer bypasses those legacy text features.

The indexed core contains 20 text recipes with 15 distinct strings and 25
bitmap recipes with 15 distinct shapes across 198 building recipes. Most
outline entries are rectangular facade/vent detail, so a raw sign count is not
a lettering count. The existing outline asset library already contains seven
font variants plus custom forms. Reuse that workflow for checked typography.

The next private Cockrell candidate removes the false horizontal wall bands,
uses the existing filtered brick shader, aligns door frames and handles with
the recessed entrance glass, adds an attached fascia/soffit and restores
masonry landing piers, a bronze plaque shape and tubular handrail returns.
Front and oblique views are retained at matched cameras. Metric entrance
dimensions, exact glass appearance and camera calibration remain provisional.
The refined east facade and connected engineering ground are not accepted.

Public integration still belongs to the Acer bake/renderer lane. Private
comparison images, candidates and camera metadata remain outside the repo.
This continuation stays on `codex/campus-photo-pilot`.


## Cockrell correction after the owner’s 5.5/10 review

The owner’s review exposed errors visible in the supplied photos. The prior
pass should have caught them before showing the trial. It is retained as a
control and is not accepted. The next private candidate uses two paired rail
assemblies at the stair thirds, four paired post stations per assembly, and
3/4/4/3 window lights with narrower outer openings. It restores stronger piers
below continuous roof coping, dark projecting window heads, sloped brick sill
aprons, substantial separators and lower framed sashes.

Additional independent misses: separate wall-attached side rails, broad
landing-pier fronts and plaque placement, coarse concrete treads with projecting
nosings, sparse plaza joints, narrow center fixed panel between double doors,
door pulls attached at both ends and lights under the canopy.

Regular wall brick and upright sill coursing use compact shared material
descriptions; piers, recesses and slopes remain geometry. The private candidate
and all appearance parameters stay outside the repo. Glass uses darker varied
panes with the existing view-dependent reflection response. Exact reflected
surroundings, concrete aggregate, camera fit, metric entrance dimensions,
lettering identity, unphotographed faces and connected ground remain unresolved.

Review the whole facade and stair topology against photos before accepting any
material or lettering improvement. The correction is pending the owner’s
visual review. This pass stays on `codex/campus-photo-pilot`; shared owner
feedback was recorded in AGENTS.md and fetched on the Acer.

The completed correction uses 78 blocks and 1,049 detail records, including
compact strip geometry for nested pane borders. Whole-scene triangles are
3,194,403–3,194,405 across the final roof-cap variant; this is not an FPS claim.
The complete corrected recipe is about 29.3 KiB gzip, compared with about
12.8 KiB for the rated control. Upright sill joints initially cost 84 KiB
when emitted individually; the shared material removed that avoidable cost.
Hardware GL verification on Intel Iris Plus 655 cancels graphics autodetect,
waits for the final building, and retains the second screenshot of four views.
No page errors or missing model were reported.


## Flared stairs, face-aware brick and camera metadata follow-up

The bottom three Cockrell risers now have separate progressively wider plans,
with rounded noses. The upper six retain the main flight width. The outside
rails are independent paths: the plaque-side rail has a front wrap and a
transverse run at the flare; the opposite rail retains its simpler incline.
The exact flare extensions and elbows remain metric inference.

Brick materials use separate horizontal directions on perpendicular facade,
pier and wing-wall faces. Small selected cap surfaces use upright courses;
compound corner phase and slope bond remain provisional. The lower inscription
is actually longer in the close reference: four approximate planar corrections
give lower/upper widths 1.115–1.125, so the private trial uses1.12 rather than
the previous arbitrary1.034. The user's width question and the conflicting
image measurement are both retained in the private evidence ledger.

The original images provide capture time, focal equivalence, true heading and
GPS; the horizontal accuracy field reports about14.25m. The GPX has timestamps
from the same morning despite its filename, but a40-minute gap surrounds the
Cockrell photos. It cannot supply a contemporaneous position. The wide image
used14mm-equivalent ultrawide framing; prior56.816-degree horizontal framing
was incorrect. Metadata indicates about85.67degrees as a starting value.
A manual ten-landmark camera fit yields about14.3pixel coordinate RMS at
900x1200 against the estimated model. That is fitting residual, not independent
validation or proof of exact camera calibration. Surveyed control-point joins,
eye height, lens crop/distortion and independent residual checks remain open.

The new Cockrell candidate labels unreviewed rear/side completion inference,
derived from visible owner-photo rhythm. NHB contains no field `_src` stamps
and no explicit claim of owner-photo sources; it already describes northern
elevation completion and metric estimates. Four northern-face inference
annotations were prepared privately, keyed to the current recipe hash. Acer
integration should attach them to the corresponding fields and audit remaining
source identities instead of labeling the whole building owner-photo built.

Shared evidence policy was updated and pushed to main. Modeling and camera
artifacts remain private. Branch: `codex/campus-photo-pilot`.

The final follow-up detail render reports no page errors,78blocks and
3,194,485 whole-scene triangles; the private recipe is about31.4KiB gzip.
These are build/data checks, not an FPS improvement or visual acceptance.
Second entrance and stair-side frames match the final candidate hash.
The camera fit is a separate experiment. A direct-perspective custom-layer
render is used to inspect the full ultrawide frustum because the map camera
clamps upward pitch and large principal-point shifts. Do not substitute its
simplified background for public-city rendering or label it exact calibration.

## Rail and inscription review after the rejected follow-up

The owner correctly identified that the plaque-side rail was wholly outside
and too short. The private revision now starts on the stair-facing side,
turns across the plaque front with two mounting plates, wraps outside and
continues to the free pavement post. The upper attachment is partly hidden
in the photo and remains inference. Visual checks also exposed a wing/pier
junction burying the plaque and crossing; the private front-pier depth was
adjusted to expose them. This is an estimated dimensional correction, not a
surveyed match. Previous candidates are retained for comparison.

The inscription used per-line contour height. The comma's descender made
the upper capitals about18% smaller than the lower capitals. Both lines now
use one capital-height and baseline metric, with the comma below the baseline,
and horizontal visible-ink bounds. The active signs and glyph-library placement
records agree. The lower line remains longer in the reference, but that width
relationship alone does not verify the match. Overall size was reduced to
avoid the projecting masonry; letterforms, spacing and positioning remain
approximate. The source photo and revised close-ups are shown together.

Branch: `codex/campus-photo-pilot`. Shared review was pushed in AGENTS.md and
fetched on the Acer. All photo assets and modeling changes remain private.

## Assessment and proposed transfer test

The owner asked whether the private trial is good enough and proposed two
fresh Sol runs on the next target: original instructions versus trial lessons.
The root's subjective photo-resemblance rating is about5.5/10; a separate
review rated6.5/10. Both consider it an unfinished trial and advise against
broad unattended rollout. Glazing, window heads, facade/entrance proportions,
masonry/weathering, wing-wall junctions, concrete, plaque and camera alignment
remain open. Repairing a reported detail does not establish a complete match.

A private comparison brief and transferable lessons were prepared, not run.
Hold the building/photo group, tools, code snapshot, reasoning effort and
budget equal; isolate fresh builders; preserve first and final bounded
candidates; judge them blindly from full and close application views. Current
AGENTS.md includes trial lessons and would contaminate a supposedly blank
baseline, so isolate the common original brief and evidence carefully.
Compare cost and repair effort alongside appearance; one pair is an initial
signal and should be repeated on a different target before broad adoption.
Do not transfer Cockrell dimensions or imply every building uses its design.

Branch: `codex/campus-photo-pilot`. No modeling changes were made this pass.
HANDOFF.md is touched by other open lanes, so this record remains in the
existing owned photo-pass document.

## Quality-per-dollar method recommendation

The owner challenged the assumption that a short brief could raise a poor
match to7–8 and observed that repeated hidden self-review may merely cost more.
The recommendation is to freeze Cockrell as a failure benchmark and test a
small different facade/entrance group. Compare the current photo-to-code method
with a measured feature specification plus deterministic component geometry,
at equal total cost including unique preparation and independent evaluation.
This changes the tested method rather than isolating prompt wording alone;
retain the original context-only proposal as a separate possible experiment.

Camera registration, planar image measurements, rail paths, window profiles,
stair tiers and shared lettering metrics can reduce repeated freehand guessing.
Model interpretation still needs evidence and uncertainty checks. Rectified photo
detail is useful for surfaces but can bake temporary shadow/reflection. Multi-view
reconstruction is conditional on overlap and viewpoint separation; the photograph
count alone does not establish suitability. Survey/LiDAR is preferable for metric
height. A stronger model on a bounded interpretation task could be economical,
but no quality jump or savings has been demonstrated by this recommendation.

No new model, geometry pass or two-arm comparison was launched. The private
proposal was updated and the owner's quality-per-dollar concern recorded in
shared AGENTS.md. Branch: `codex/campus-photo-pilot`; HANDOFF.md remains touched
by other open lanes, so the record stays in this owned pass document.
