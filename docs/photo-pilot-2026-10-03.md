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
