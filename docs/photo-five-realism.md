# Five architectural reference targets

This pass rebuilds Welch's courtyard, Waterline, Sixth and Guadalupe,
Wukasch/Barefoot and University Co-op. It replaces the rejected block lettering
and generic tower forms with structural and facade detail. These remain
approximate architectural models; they are not photogrammetric reconstructions.

## What changed

- Welch: a lower central courtyard projection, divided windows and blind brick
  arches, balustrades, split terrace levels, stairs and railings, sloping steel
  shade roofs with actual beams and columns, planting and furniture. The other
  wings retain their previous heights. One explicitly identified legacy roof is
  replaced; its sibling roof and neighboring roof assemblies remain.
- Co-op: a deep entrance portal, narrower side storefront openings with masonry
  piers, subdivided glazing, projecting awnings and cornices, smooth panel
  cladding, solid serif lettering and legible banner shapes.
- Wukasch/Barefoot: shaped parapet and brick corbelling, diamond infill, timber
  sign panels, substantial canopy ties, recessed doors and subdivided glazing.
  The curved brand mark is contoured from the brand's public logo; it is not
  rebuilt from a block alphabet.
- Waterline: distinct offset hotel, office and residential volumes, open
  transition terraces, inclined supports, and the broad supported crown.
- Sixth and Guadalupe: separate office and residential volumes, recessed
  balcony edges, an open transition and broad crown with a blue edge.

## Implementation boundaries

`author_welch_courtyard.py` updates only Welch's model. Optional structural meshes
are validated before any building geometry is emitted. Selective roof exclusion
is applied only when the replacement model succeeds and is restored on failure.

`bake_guadalupe.py` updates its own output; the 65 other shop models are unchanged.
The older Drag bake and campus-storeys experiment remain untouched. Cached sign
outlines allow ordinary baking without a local font installation, fontTools or
Pillow. Public logo provenance is in `data/sign_sources/README.md`.

Only these two shops opt into shallow parallax display interiors. They are
approximate displays, not replicas of private shop interiors. Their default
closed-room night state is preserved. Appearance controls live in
`SLOPES.storefront` and `APTS.materials.shopGlass`.

`bake_outer.py --landmarks-only` replaces exactly the two known legacy tower
recipes or its own prior tagged output. It rejects changed legacy inputs rather
than deleting an approximate geographical area. Unrelated outer-ring features
are preserved. Tower heights remain 315 m and 267 m; this pass does not settle
conflicting published height measurements. Dimensions and colors are editable
in `scripts/downtown_landmarks.py`.

Owner imagery, reference source identities and camera records remain outside the
repository. Banner art is simplified; weathering, fine interior detail and the
remaining citywide facade/motion issues are not claimed complete. Physical-phone
performance and memory are not measured by this visual pass.

## Verification

Final matched application comparisons and delivery verification are pending.
Do not treat the implementation description above as visual acceptance.
