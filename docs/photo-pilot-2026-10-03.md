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
