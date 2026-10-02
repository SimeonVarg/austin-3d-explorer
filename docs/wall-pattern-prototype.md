# Compact wall material prototype

Status: local visual proof, not enabled in the application. The owner must
review the appearance before production integration or broader migration.

Ordinary brick facing can dominate an authored building file even when the
renderer batches its triangles. This experiment replaces that facing with a
small material description while retaining the supporting walls and decorative
geometry. It does not flatten projecting borders, arch rings, piers, recessed
windows, or doors.

`js/wall-pattern-prototype.js` supplies an opt-in material table and filtered
running-bond shader. Building authors choose a module in metres, mortar width
and colour, weighted day/gold/night tones, deterministic seed, local axis and
phase. A building-local coordinate frame keeps the pattern independent of
camera movement and avoids anchoring it to rounded wall normals. Palette and
mortar coverage blend toward their area-weighted mean when bricks become
smaller than a pixel. Selected colour goes through the existing city lighting.

The public application does not load this module. The proof adapter in
`scripts/verify/wall-pattern/adapter.mjs` inserts two narrow hooks into served
source in the test browser. It fails on missing anchors or duplicate
integration. The shared renderer source files are untouched because other open
PRs own changes there. This adapter is temporary; it is not a production
loading mechanism.

## Authoring shape

```json
{
  "materials": {
    "field": {
      "type": "brick",
      "strength": 1,
      "scale": [0.28, 0.087],
      "pattern": {
        "version": 1,
        "seed": 28,
        "axis": [1, 0],
        "phase": [0, 0],
        "tones": [["pale", 2], ["warm", 1], ["dark", 1]],
        "joint": {"width": 0.014, "tone": "mortar"},
        "filter": [0.35, 1.25]
      }
    }
  }
}
```

The field and all referenced tones must exist in the building colour palette.
Reference the field from an existing flat skin or a selected detail mesh.
Selecting the skin alone does not cover walls provided by custom meshes.
`axis` is in the building's local horizontal coordinates; `phase` is horizontal
and vertical offset in metres. Filter thresholds are cells per pixel.

The prototype accepts at most six weighted tones and 64 registered patterns.
It uses one 32 KiB float parameter texture, not an image of the building.
It does not yet offer every bond, clustered weathering, or border generator.
Do not infer support for every masonry type or a city-wide capacity claim from
this one-building experiment. The existing emergency phone mode still disables
the detailed building layer; performance presets still omit optional geometry.

## Checks and review

Run `node scripts/verify/wall-pattern/contract.mjs` for the authoring contract,
legacy palette preservation, repeated-build registration, independent local
frames, invalid inputs, and adapter drift. This is not visual acceptance.

The local full-city proof uses an immutable source building, a separate
converted candidate, identical photo camera and lighting, and second
screenshots. It includes an unused-feature control, day/sunset/night, close
crops, a distant campus view, a matched ground-height camera movement, and the
performance preset. Owner references, capture poses, candidate data, conversion
scripts and comparison media stay in private local storage.

An important failure caught visually: interpolated material index 100 can be
99.99999 inside a triangle. Testing against the exact lower bound made the
first pattern appear speckled and partly absent. Half-integer classification
and rounded table selection remove that failure. The comparison retained the
original geometric model; no colour tuning was used to conceal the fault.

The first timing matrix established cheaper active building construction but
included slower close-view frame distributions and no whole-page startup gain.
A follow-up replaces the per-tone texture loop with packed thresholds and
skips unused near/far palette reads. Its comparison image is pixel-identical;
interleaved GPU queries show a lower Three.js pass cost than the first material
version. This does not establish an end-to-end speedup over the original
geometric bricks. Keep startup, construction, and rendering claims separate.

Before production integration, finish the owner's visual review, coordinate
the two shared-file hooks with the existing PRs, exercise actual target phones,
and establish table capacity and lifecycle behaviour for the intended scale.
