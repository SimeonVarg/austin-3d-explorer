# Downtown reference audit - September 21, 2026

Status: reference inspection and initial baseline complete; architecture changes
have not started. This is not acceptance of the current downtown geometry.

The newly supplied photographs match images already present in the local owner
reference set. A downloaded original was verified byte-for-byte against that
set. Original photographs, source links, metadata, camera estimates and composite
comparisons remain local. The initial application baseline is commit `6b64a04`.
Two approximately aligned night views loaded all 196 authored buildings and all
requested tiles, with no page errors, at the balanced preset. Each retained
screenshot was preceded by a discarded first frame. The framing is not yet a
calibrated photo match and does not support pixel-level photometric claims.

## What the images expose

- Waterline and Sixth and Guadalupe are still drawn with generic taper recipes
  and masts in `scripts/bake_outer.py`. Their broad, distinctive crowns and
  program-dependent setbacks are missing. The resulting silhouette differences
  dominate the skyline comparisons even after the shared lighting improvements.
- The tower shafts, podiums and top sections need different widths and facade
  rhythms. Repeating the same lit grid over the whole height erases the contrast
  between occupied residential sections, office floors and mechanical crowns.
- Frost, Indeed and the Republic need recognizable roof profiles and distinct
  architectural lighting. The current material treatment is not a substitute
  for those shapes.
- The photographs have substantial low cloud cover illuminated by the city.
  Any later sky adjustment must distinguish cloudy nights from clear nights,
  rather than making every night uniformly brighter.

## Primary-source checks

[KPF's Waterline project reveal](https://www.kpf.com/news/waterline-austins-first-supertall-and-texas-tallest-tower-officially-revealed)
describes a 74-story, 1,022-foot tower, stacked and twisted program masses,
facades that express those different uses, and a sweeping crown. That is direct
support for replacing the generic taper and mast. It is a 2022 design reveal,
not a final survey. Its height converts to 311.51 m, while the current correction
file uses 315 m; resolve that discrepancy against an as-built source before
changing the height.

[Gensler's Sixth and Guadalupe project page](https://www.gensler.com/projects/600-guadalupe-street)
shows the broad flat crown, narrower upper residential tower and larger lower
volume. It states that terraces step back at program changes and that the Capitol
view corridor influences the shape. The current generic taper cannot represent
that design. The architect's photographs were inspected directly; they are
reference evidence and are not copied into this repository.

The 2017 lidar dataset predates these buildings. Do not use it to overwrite their
current heights or infer the new upper-floor footprint.

## Next implementation

Start with Sixth and Guadalupe and Waterline: verify the plan orientation and
setback levels, replace generic crown/mast recipes, and separate the facade and
roof-light profiles. Keep all approximation and taste values in named settings.
Then inspect the same views in day and night, as well as a public south-shore
view, before changing the remaining named crowns.

The outer-ring bake's raw input exists in the primary checkout but is untracked
and absent from the lighting worktree. Copy it read-only into the worktree before
reproduction; do not modify the primary checkout. Check that the unchanged bake
reproduces the current geometry before using it to generate replacements. The
normal application loads `data/tiles/outer.pmtiles`, so GeoJSON-only edits or
`tiles=0` screenshots cannot verify the shipped result. Rebuild and inspect the
actual tile path, preserve facade bucket parity, and avoid unrelated data changes.
