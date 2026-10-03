# Compact wall material

Status: in the app since 2026-10-02. Burdine Hall and the Norman Hackerman
Building are the first two buildings that use it. The owner compared it with
the old per-brick geometry from the same camera and called the two identical.

Ordinary brick facing can dominate an authored building file even when the
renderer batches its triangles. This material replaces that facing with a
small description while keeping the supporting walls and the decorative
geometry. It does not flatten projecting borders, arch rings, piers, recessed
windows or doors. Those stay geometry.

`js/wall-patterns.js` supplies the material table and a filtered running-bond
shader. Building authors choose a module in metres, mortar width and colour,
weighted day/gold/night tones, a seed, a local axis and a phase. A
building-local coordinate frame keeps the pattern still while the camera moves.
Palette and mortar blend toward their area-weighted mean when bricks become
smaller than a pixel. The selected colour goes through the existing city
lighting.

## Where it hooks in

- `index.html` and `_harness.html` load `js/wall-patterns.js` before
  `js/slopes.js`.
- `js/slopes.js` attaches the table to the shared material and adds the
  shader code (two template insertions and one `attach` call).
- `js/slopes-apartments.js` registers each building's patterns in
  `buildingOne()`, right after the building frame is made.

A building with no `pattern` is untouched: its palette is not changed and no
table row is used.

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
Selecting the skin alone does not cover walls drawn by custom meshes.
`axis` is in the building's local horizontal coordinates; `phase` is the
horizontal and vertical offset in metres. Filter thresholds are cells per
pixel.

## Limits

At most six weighted tones per pattern and 64 registered patterns in the
whole city. It uses one 32 KiB float parameter texture, not an image of the
building. Running bond only: no other bonds, clustered weathering or border
generator yet. A building that repeats an identical pattern at the same
origin reuses its row.

## Checks

`node scripts/verify/wall-patterns-contract.mjs` checks the authoring
contract, legacy palette preservation, row reuse on rebuild, separate rows for
separate frames, invalid inputs, the three hooks, and the load order. It is
not visual acceptance. Look at the city for that.

One failure found by looking: an interpolated material index of 100 can be
99.99999 inside a triangle. Testing against the exact lower bound made the
first pattern speckled and partly missing. The shader classifies around the
half-integer instead.

Timing so far: cheaper building construction than per-brick geometry, and a
lower three.js pass cost after the packed-threshold change. No whole-page
startup gain is claimed. Keep startup, construction and rendering claims
separate.
