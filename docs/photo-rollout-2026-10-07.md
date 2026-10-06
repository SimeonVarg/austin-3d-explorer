# Photo rollout preparation — October 7, 2026

God's Eye View is useful for planning where to look and for making camera
records explicit. It does not fill missing photographic evidence. Its verified
free setup displays Esri aerial imagery over regional terrain, without
photorealistic buildings. See [the companion assessment](gods-eye-view-assessment.md)
and [launch instructions](../scripts/gods-eye/README.md).

## What overhead views add

Most campus buildings can benefit from a roof view: roof outline, connected
wings, ridge/valley topology, terraces, service structures and relationships
between buildings. A roof check does not establish window rhythm, recessed
glazing, stairs, entrances, balcony depth or an occluded wall. A facade check
does not establish the unseen roof. Keep separate evidence and acceptance for
these parts.

Use overlapping ground views and independent surveyed heights where available.
For a building newer than the available scan, an empty scanned site supplies no
roof measurement. A newer scan must be checked against its actual tile coverage
and acquisition date before treating it as an answer. Public aerial products
need their source-use terms verified before geometry, colours or textures are
derived for publication.

The Google-powered companion can help a person scout viewpoints. Google's
[Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies)
forbid deriving objects by hand or machine from Photorealistic 3D Tiles and
prohibit image analysis, machine interpretation and geodata extraction.
The [Earth guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/)
also prohibit using its output to reconstruct 3D models or similar content.
Do not feed those captures to a model, trace them or turn their appearance into
recipe parameters. The code's MIT licence does not license provider imagery.

## Prepare agents before considering training

Start with a small, repeatable evidence packet and the existing private run kit.
More instructions and more review rounds are hypotheses to test, not measured
improvements. The existing local reconstruction pilot did not recover a usable
whole-building mesh; its source/output records remain in the private evidence
store. The [photo pilot](photo-pilot-2026-10-03.md) records related modeling limits.

For each eligible building, prepare:

1. Verified source identities and coverage by side, including explicit gaps.
2. Measured shape/height inputs with dates, units, uncertainty and field-level
   provenance; identify inferred dimensions individually.
3. Camera records with proof images and an actual-app preflight. A mathematical
   fit can still put the eye inside a neighbour or behind trees.
4. A compact example of an accepted result and a visibly failed result, with
   the established review rubric. Keep examples and owner context private.
5. A baseline, a few fixed views and photos withheld from fitting/revision.
   Hold out viewpoints, rather than near-duplicate frames from the same spot;
   check transfer to another building before claiming generalisation.

Gate the plain shape before openings and materials. Check the whole silhouette,
wings, setbacks and floor relationships across different sides. Count openings
and model depth next; add materials last. Draw all four sides before handback.
An unseen side stays inferred and must receive an explicit regression check
against the current app. A fresh reviewer helps find errors; owner visual
acceptance remains the publication decision for a new building.

For an instruction/tool comparison, freeze the same evidence, model settings,
time/spend allowance and baseline for both arms. Record total preparation,
building and review cost, as well as reusable setup cost separately. Assess
wrong identities, camera failures, invented features, shape on held-back views,
opening counts, unresolved inference, and owner acceptance. An automated pixel
score supports diagnosis; it is not a substitute for recognising the building.
Report failures and excluded views as well as successes.

Actual fine-tuning is a later research option for narrow repeated tasks such as
photo-to-building identification or structured feature extraction. It needs
consistent labels and a held-out answer key first; it cannot supply hidden
dimensions or correct source provenance. Do not start a bulk photo-reading job
until its scorer and quality-per-dollar baseline exist.

Current [OpenAI deprecation guidance](https://developers.openai.com/api/docs/deprecations)
states that self-serve fine-tuning is unavailable to new organisations, restricts
inactive existing users, and ends new jobs for active existing customers on
January 6, 2027. Account eligibility has not been checked. Hosted Evals becomes
read-only October 31 and is scheduled to shut down November 30, 2026. Use portable
local records and scorers; do not build this rollout around either service.
The [evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
supports task-specific tests, representative held-out cases and human calibration.
No training, hosted evaluation or paid model job is part of this preparation.

## Tools that fit the immediate job

Reuse the existing private candidate finder, by-eye contact sheets, camera
fitter, application preflight, recipe lab and review anchors. Do not replace
them with GPS/compass-only grouping: it is a shortlist, not proof of identity.

The new [photo rollout helpers](../scripts/photo-rollout/README.md) provide an
isolated dependency check/setup and comparison receipts. They use NumPy/Pillow
for images, headless OpenCV for masks/projection, Shapely for polygon operations
and pyproj for explicit survey coordinates. A projection library does not
provide a geoid model or make phone altitude a survey measurement.

The capture receipt binds recipe, camera and drawing settings before a render,
then records the frame and independent building mask. Acceptance checks the
hashes and rejects stale or blank panels before composing a sheet from the
verified manifest. A mask must actually describe the rendered building; these
helpers do not create or independently validate its semantic identity. Open
every final sheet. Automated acceptance here means intact capture evidence,
not an approved building.

Useful bounded follow-up experiments:

- **Overlap graph with OpenCV:** test whether adjacent original photographs
  share geometrically consistent feature tracks before another reconstruction
  run. Repeated windows and glass can produce misleading matches. Compare
  connected coverage across sides, not just match counts.
- **COLMAP on a small cleared sequence:** use moving, overlapping daylight
  photographs, stable lens settings and independent scale checks. Two opposing
  corner pictures are useful human references but do not meet its recommendation
  that each object appear in at least three overlapping images. The
  [capture tutorial](https://colmap.github.io/tutorial.html) also warns about
  specular surfaces and photographs taken by rotating at one location. Reuse
  the existing private installation before installing another one.
- **One-load recipe comparisons:** reuse the private recipe lab to compare
  variants at fixed views, then confirm the selected result in the full city.
  Any promised speed gain needs measured end-to-end timings including setup.
- **Shared materials and glyph contours:** reuse the existing compact wall,
  roof and lettering systems for verified repeated features. Keep building
  silhouette, opening rhythm and unusual signs specific to the evidence.
- **Blender as a small shape-authoring trial:** compare one irregular building
  with the native recipe route before making it a dependency. Its export must
  preserve coordinate scale and fit the renderer's memory/draw budgets.

Large neural reconstruction packages, a new rendering engine and a generic
vision-training stack add setup without resolving the current evidence gaps.
They remain experiments until a small controlled trial improves the held-out
result or total cost.

## Wednesday sequence

First inventory verified sources and mark missing sides/roofs. Keep the detailed
capture guide and per-building metadata in the private evidence store. Preserve
original files; create GPS-free, orientation-normalised working copies for model
input while retaining the original privately.

Then prepare one older building with a usable survey shape and one newer
building needing photo shape evidence. Their identities, execution route and
rollout spending ceiling are owner choices, so this document does not start
those builds. Run camera preflight and a baseline before spending on geometry.
Keep source dates, temporary covers and intended permanent appearance explicit.

After the two pilot results are reviewed, estimate cost from the complete runs
and choose how wide to proceed. Treat lack of evidence as a capture task rather
than a reason to repeat unsupported modeling. No new city model is accepted by
this preparation pass.

## Verification record

The companion is installed and its helpers were merged in PR #409. Its real
browser acceptance record remains in the companion assessment; it was not
repeated for this documentation/tool-only pass. New helper verification and
runtime verification passed on both an existing Python 3.9 environment and a
fresh external Python 3.12 binary installation. The second setup run reused
that installation. Four feature smoke checks, package consistency, all 25
acceptance/runtime tests, harness script parity (54 scripts) and whitespace
checks pass. Failure tests include changed renders/recipes/masks, different
cameras/settings, undersized masks, stale sheet pixels with an updated sheet
hash, and output paths inside Git. No browser or city render was started in
this pass. Scratch captures and private source metadata remain outside public Git.
