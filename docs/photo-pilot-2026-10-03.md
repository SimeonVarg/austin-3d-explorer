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
The exact photographed lettering should be traced or matched to a properly
licensed font before claiming exact identity. Font files are not redistributed.

HANDOFF.md overlaps other open PRs (#348, #312, #307, #189, #164); this separate
pass record avoids writing over their lane work. The old Mac queue names only
DKR, so new photo candidates remain private until an explicit bake/output
ownership addition or Acer integration.
