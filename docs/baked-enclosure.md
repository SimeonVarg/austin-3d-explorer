# Baked enclosure layer

Status: isolated implementation, not enabled by production index.html. The core
generator and lighting files are currently owned by open renderer/mobile work.
`scripts/enclosure/integration-overlay.mjs` contains the explicit integration
hooks used by the full-city verification browser, without changing those files.
Branch: `codex/baked-enclosure-layer`, based on main
`91a41069dde872e3cc0171a9050c915a5653f79f`. Generator integration is held behind
the active renderer/mobile lanes; this document records this pass without editing
their shared HANDOFF.md.

## What this adds

An arch interior or recessed entrance receives less diffuse sky light than an
open wall. The existing sunlight/shadow system already accounts for direct sun;
this layer adds static, local enclosure to its ambient/sky term. It leaves direct
sun, reflections and the night lighting path alone. It does not invent geometry.

The first assets cover Battle Hall, Union Building and Mary E. Gearing Hall.
Their 186,561 bytes compress together to approximately 50 KB. A seven-bit value
uses unused bits of the existing unnormalized Uint8 aFacet attribute. Bit zero
retains the roof-facet meaning. There is no new draw, texture, vertex buffer,
screen-space pass or runtime ray tracing. The shader gains one interpolated
scalar and a small amount of arithmetic; this is not a claim of zero cost.

`BakedEnclosure.create({strength:.8})` parameterizes appearance. The valid range
is zero to one. Radius and ray count are offline parameters. Glass, emission and
shop receivers are excluded. Indirect light is not artificially applied at night.

## Asset contract and ownership

`js/baked-enclosure.js` owns decoding, validation, shader adaptation and leases.
The generator supplies a newly built, unpublished mesh and local triangle ranges
identified by building name. Every target is verified against SHA-256 digests of
positions, normals, surface classification, rebased indices and original facet
bits. Names select candidates; exact geometry validates identity. Global vertex
offset changes are supported; changed geometry fails open. Negative float zero
is canonicalized; other float values are checked exactly.

An entire asset set is prepared before any bytes or shaders change. Missing,
corrupt, obsolete or incompatible assets leave the original mesh/material intact.
Payload checks include size, counts, low-bit meaning, glass/emission protection,
overlapping spans and unique building identity. Duplicate leases are rejected.
The shader adapter requires each expected source anchor exactly once; upstream
shader changes cause fallback rather than a partially modified program.

The caller MUST keep geometry/material inputs immutable while attach is pending,
await attach before first scene publication, and dispose the lease/session before
mutating or destroying its mesh. The overlay listens to geometry disposal to
release the lease during normal rebuild and superseded-build cleanup. A generation
token prevents a cancelled network response from publishing later. Asset fetches
time out after two seconds by default. No shading is better than a blocked city.

Geometry disposal remains the generator's responsibility; this layer never
disposes shared textures, materials or attributes. Shared sun uniforms retain
their original object identities, while the enclosure strength is material-local.
Releasing a lease restores original facet bytes, shader strings and uniforms.

## Offline pipeline

Export geometry outside the checkout: an export directory contains manifest.json
with `commit`, `sources` and `targets`; each target has `name`, `slug`, and a
`<slug>-geometry.json` with rebased `indices` and `attributes` for position,
normal, aSurface and aFacet. Each attribute has `array` and `itemSize`. These are
the same typed data the current generator renders, not a second authoring model.

```
npm --prefix scripts/enclosure install --ignore-scripts
// Start scripts/serve.py on a unique local port and set VERIFY_URL to it.
// The existing scripts/verify dependencies and installed Chrome are required.
node scripts/verify/export-enclosure.mjs --out <exports>
node scripts/enclosure/bake.mjs --source <exports> --out <scratch-bake>
node scripts/enclosure/package.mjs --source <scratch-bake> --geometry <exports> --out data/enclosure
node scripts/verify/baked-enclosure.mjs
node scripts/verify/enclosure-city.mjs --out <outside-repo-captures>
```

The bake traces 64 deterministic cosine-weighted hemisphere rays per cached
position/normal, with a 3 m radius and 2 cm origin bias. Double-sided local
geometry occludes rays. Distance weights and an 80% cap avoid completely black
cavities. Acceleration uses pinned Three r159 and three-mesh-bvh 0.7.6 offline.
`indirect:true` preserves index order. Runtime does not import either dependency.

Incremental reuse keys include the complete exported geometry, all bake settings,
algorithm version and dependency versions. Existing output bytes must also match
their digest. A changed building or setting causes a rebake. Packaging revalidates
both export and payload and runs the actual runtime decoder before publishing.
Keep geometry exports and screenshots outside the repository.

## Verification recorded for this pass

The runtime suite passed 19 cases. A fresh bake took 49.96 seconds and reproduced
the original payload byte for byte; an immediate second invocation reused all
three results. Combined gzip size is 49,638 bytes.

The full-city adapter check used hardware RTX 3050 Ti, 1440 by 960, DPR 1, CPU
throttle 1x, balanced graphics and fixed exposure/FOV. All 196 authored buildings
remained present. Attachment completed before scene publication. A complete
rebuild disposed the old session and attached a new one. Deliberately stale
geometry produced the original unencoded facet bytes. The tested center picking
ray was unchanged; it hit the structural mesh, so this is not exhaustive picking
coverage of the three shaded buildings.

Three sunset views and Union day/night were captured off/on/off, twice per state.
Return captures differed by at most one channel level on one pixel. The settled
Union night on/return images matched exactly. Six interleaved 160-frame static
Union legs retained 41 draws and 3,458,799 submitted Three triangles. Minimum
median original/enabled was 17.50/17.65 ms; minimum p95 was 20.405/20.215 ms.
This establishes no material penalty in that static test, not a speed gain or
a movement/mobile acceptance result.

The first browser attempt timed out in an overly strict observer: a dirty shadow
proxy remains dormant below the horizon. The corrected observer waits for tiles
and any active timer, and only requires the dirty flag to clear when the sun is
above the horizon. It does not alter the renderer to make the test pass.

## Boundaries and acceptance

This first asset set has no filtered facade replacements. The runtime explicitly
rejects a target marked `filtered`; it must not paint a different brightness into
near geometry and distant replacement sheets. Extending support requires baking
the same enclosure signal into both representations and checking their transition.

The bake sees only each building's own static geometry. It does not include
neighboring buildings, ground occlusion, moving objects or visibility to an
arbitrary sky/environment. Large triangles may interpolate enclosure poorly.
It is a compact quality layer, not physically complete global illumination.

Before production enablement: integrate hooks after renderer ownership clears;
rerun on the merged base; confirm same-camera day/sunset/night comparisons,
original shader versus zero-strength parity, stale-asset fallback, picking,
rebuild and actual shared-context restoration. Test real phone memory/thermal
behavior separately. Require no added draw/attribute, useful visual improvement,
compressed payload under 75 KB for this set and no repeatable frame-tail regression
over 5%. The layer stays opt-in if any gate is unresolved.

Rollback is omitting the hook/module/assets; no authoring data or geometry changed.
The next independent performance milestone is spatially bounded shared geometry
with an overview fallback. Do not combine its acceptance with this quality layer.
