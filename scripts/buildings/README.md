# Offline building assets

The compiler runs the complete production generators in a Node VM with the real
Three.js 0.159.0 classes. It initializes the existing shared ENU frame and creates
real geometries and facade textures. It needs no renderer, GPU, browser, network
or DOM after dependencies are installed. Timers are inert; the compile hooks
return owned results without running the city boot sequence.

From the repository root:

```sh
npm ci --prefix scripts/buildings --ignore-scripts --no-audit --no-fund
node scripts/compile-buildings.mjs --only welch
node scripts/compile-buildings.mjs --only welch,painter,gdc,nueces,standard
```

The default selection is Welch only. `--out DIRECTORY` writes an independent
catalog; `--filter-resolution 1` selects the recorded desktop facade resolution.
The baseline uses detail 1, uncompressed desktop attributes, and 8,192-triangle
chunks with boundaries between complete primitives. No authored data, palettes,
shader source, window patterns, dimensions or triangle topology are simplified.

The catalog is limited to Robert A. Welch Hall, T. S. Painter Hall, Gates-Dell
Complex, 2400 Nueces and The Standard. Original source catalogs remain intact.
GDC retains the existing MapLibre hero features and material adapter plus its
separate Three.js roof underside geometry. Its facade features are not converted
into a substitute Three material.

## Determinism and ownership

Each file is named `<building UUID>.<whole-file SHA-256>.fba`. The manifest stores
that hash, the source hash, compiler hash, byte counts, bounds and compact building
metadata. JSON keys, buffer traversal and manifest order are deterministic;
timestamps and generation timings never enter an asset or manifest.

Source hashes cover the selected canonical building spec. For GDC they cover
only its selected hero features, replacement ID, roof ID and height. Changing a
sibling in `campus_buildings.json` or `heroes.geojson` does not invalidate Painter
or GDC. Collection source references select by stable building ID; reordering
sibling records does not stale a numeric source pointer. Shared generator, tune,
compiler and dependency files are hashed
separately. Apartment and hero renderers have separate generator dependencies.
Line-ending changes do not alter compiler hashes.

An unchanged source/compiler pair reuses its asset only after verifying its
whole-file hash and decoding it. A no-op performs no generator work and no output
writes. Every requested changed building is generated, encoded and validated
before any output write. Files are staged and reread, immutable content files
are installed, then one atomic rename replaces the manifest. Invalid input leaves
the previous manifest and old valid assets intact. A process interruption before
the final rename can leave an unreferenced content file; it cannot point the old
manifest at a partially written new file. Old assets are not garbage collected
automatically, because a running page can still hold an earlier manifest.

The compile caller owns returned geometries, facade batches and materials.
`runtime.dispose(result)` releases all of them. No global scene material is
disposed: `slopes.material()` creates a distinct owned material with shared
uniforms. Geometry arrays remain retained and exact until serialization.

## FBA1 wire format

All header integers use little endian. Typed-array payloads preserve the desktop
little-endian representation, including signed zero and Float16 storage bits.

| Offset | Width | Value |
| --- | --- | --- |
| 0 | 4 | ASCII `FBA1` |
| 4 | 2 | Schema version `1` |
| 6 | 2 | Flags `0` |
| 8 | 4 | UTF-8 canonical JSON byte length |
| 12 | 4 | Payload byte length |
| 16 | variable | Canonical JSON descriptor |
| aligned to 8 | variable | Aligned typed-array payloads |

The JSON root is `{schemaVersion, asset, buffers}`. Every typed array in the asset
is replaced by `{"$buffer": n}`. Its buffer entry is
`{type, length, byteOffset, byteLength}`, with byteOffset relative to the payload.
Every array starts on an eight-byte boundary. Repeated references to the same
typed-array object share one payload entry. No compression, quantization,
reindexing or normal recomputation occurs in the codec.

An asset contains:

- `building`: stable UUID, name, ENU bounds and enclosing sphere.
- `origin`: longitude/latitude plus `units: 'metres'`, `axes: 'east,north,up'`.
- `source`, `compiler`: canonical source hash, public source selector, compiler
  version, pinned Three version, options and dependency hashes.
- `metadata`: authored frame, footprint, roof/rake/sign/inset data and aliases
  where the existing generator provides them. Authored block IDs use the source
  block ID/name, falling back to its index. Original block plans and editable
  dimensions remain available. Source priority is explicit; confidence is
  `unreviewed` and measurement status `not-surveyed`, not an invented measurement.
- `parts`: stable ordered IDs such as `<UUID>/opaque/0000`; each has bounds,
  geometry attributes, unsigned triangle index, and a `slopes` or `facade`
  material descriptor. Attributes preserve array type, itemSize, normalized and
  isFloat16. Filtered parts retain the actual day/gold/night RGBA array texture
  data, dimensions, mip/filter/wrap/color-space settings, face dimensions and
  material options.
- Optional `maplibre`: `{adapter:'heroes', schemaVersion:1, featureCollection}`.
  The original composed feature properties, polygons, replacement identity and
  authored roof identities remain intact. Grouped band metadata provides source
  selectors without copying thousands of facade polygons into the manifest.
- `stats`: exact retained geometry/texture bytes and Three triangle count. GDC
  feature JSON bytes are reported separately; MapLibre GPU bytes are unknown and
  explicitly `null`, since its eventual tiled allocations are renderer-owned.

The portable ES module `js/building-asset-codec.js` exports
`encodeBuildingAsset`, `decodeBuildingAsset`, `buildingAssetHash`,
`decodeVerifiedBuildingAsset`, `validateBuildingAsset` and `canonicalJSON`.
`decodeVerifiedBuildingAsset(bytes, {expectedHash, expectedId})` verifies SHA-256
before decoding. Direct decode accepts an optional expectedId and size limit.
Views reference one backing buffer, suitable for a worker transfer. An unaligned
Node Buffer is copied once so typed views can be constructed safely.

Decoding rejects incompatible schemas/flags, excessive or truncated lengths,
bad typed-array layouts, overlapping/unreferenced buffers, unsafe keys, wrong
identities, non-finite positions/normals/half floats, invalid shader attributes,
out-of-range indices, geometry outside its bounds/sphere and invalid facade
texture layouts. GDC validation also checks feature properties, colors, closed
polygon rings and every facade endpoint against the same ENU bounds/sphere.

## Regression evidence

```sh
node scripts/verify/building-codec.mjs
node scripts/verify/building-catalog.mjs
node scripts/verify/building-compiler.mjs
node scripts/verify/building-assets.mjs
node scripts/verify/building-residency-contract.mjs
node scripts/verify/building-loader-cancellation.mjs
node scripts/verify/building-hero-teardown.mjs
node scripts/verify/building-residency-paths.mjs
node scripts/verify/building-codec.mjs --break
node scripts/verify/building-compiler.mjs --break
```

The two `--break` runs intentionally corrupt one attribute and must exit nonzero.
Tests compare exact arrays through real Three buffer attributes, exercise corrupt
headers/data and transaction failure, verify no-op file hashes and timestamps,
check sibling dependency isolation, and compare CPU ray hits against a fresh
Welch generation. Every yielded compiler pause also checks that live city
counters remain unchanged. Facade texture tests use actual `FacadeFilter` batches.
`building-assets.mjs` requires the five emitted files and compares each one to a
fresh production generation, including all attributes, textures, material
descriptors, metadata and current dependency hashes. `--only welch` checks the
initial single-building stage.

`building-residency-contract.mjs` exercises the production controller, worker and
loader with real Three classes and controlled map/worker events. It checks
conservative low-sun shadow retention, distinct CPU backing stores and GPU
attribute identities, transferred Float16 views, allocation limits, stream/hash
rejection, malformed URLs, configuration validation, cancellation, source
replacement during an outstanding fetch and queued work during context loss.
Restoration resumes both compiled and local detail without an asset-error delay.
Initialization cases cover malformed manifest fallback, loss before the manifest
arrives, a renderer already lost on entry, retained coarse objects across a later
loss, and listener/worker/resource cleanup after initialization failure or abort.
The real upload implementation waits for a delayed renderer, supports aborting
that wait and fails at a bounded timeout. Two-building travel cases independently
limit GPU and CPU capacity to one detailed building, keep both requested, then
verify that detail follows the nearer building and returns without waiting for
an asset-error backoff. A per-asset staging limit remains a real rejection.
The GPU byte oracle is Three's real `WebGLAttributes` cache with a recording GL
stub; these checks do not allocate a WebGL context. A preserved module directory
can be checked with `--modules=DIRECTORY`. All 22 contracts pass against the
current runtime. The original preserved implementation fails eight earlier cases:
shared GPU attributes, Float16 view ownership, superseded fetch, malformed URL
slot leakage, secondary configuration
validation, GPU capacity during travel, temporary CPU preflight pressure and
queued generation while the context is lost. A later preserved runtime also
fails the new renderer-wait case because it rejects before restoration can finish.
A snapshot taken before the initialization fixes fails all five new initialization
cases for the intended manifest, loss-observation and generation-pause defects.

The separate cancellation suite runs the actual worker and codec in Node worker
threads. Its 11 cases hold hashing open, repeat cancellation, exercise queued
and concurrent requests, race loaded/error responses, abort fetch and streaming,
close or fail the worker, and check a real residency controller's reservation.
The preserved earlier loader fails all 11. The hero teardown suite has six
cases against the real hero host; four fail with the earlier adapter, including
the destroyed-style restoration error. Ordinary eviction and temporary style
interruption remain covered.

The deployment-path suite has nine cases through the real controller, loader,
worker and hash decoder. It covers domain-root and project-directory hosting,
page query/hash suffixes, explicit manifest overrides and missing manifest or
asset responses. Successful cases require the intended compiled asset hash;
falling back to generated detail cannot hide a bad request URL. The earlier
domain-root default fails the project-directory case.

Welch's initial baseline is 44,973 triangles, 5,881,926 geometry bytes and six
opaque parts. Its recorded bounds are `[99.1585922241211,-31.090110778808594,0]`
to `[214.05282592773438,302.7442932128906,22.94549560546875]`. Existing generator
band warnings are preserved rather than silently repairing authored content.

The final five-building bake contains 411,792 Three triangles,
47,019,860 geometry bytes and 1,293,312 facade texture bytes in 71 parts. Its five
files total 50,023,568 bytes; the manifest adds 30,083 bytes. GDC accounts for six
of those Three triangles plus 3,881 MapLibre features (1,530,006 JSON bytes).
2400 Nueces is the largest independent asset at 30,223,656 bytes. All 35 CPU
checks passed against the final dependencies. Every rendered payload remains
byte-identical to the earlier five assets, including GDC's complete feature
collection. Painter gained 80 descriptor bytes for its stable source selector.
Both deliberate corruption checks fail at their intended byte comparisons,
and a real no-op preserved every file hash and nanosecond mtime without invoking
the generator.

MapLibre's exact operation order matters. Its 5.24.0 `meterInMercatorCoordinateUnits`
computes `1 / earthCircumference * (1 / cos(latitude))`. Reassociating this as two
divisions left Float32 positions unchanged but changed the first normal at byte
363800. The CPU regression fixes the recorded scale and normal bits; the shim
keeps the original multiplication order. The source is the pinned package's
`src/geo/mercator_coordinate.ts`.

CPU checks establish binary/geometry/metadata correctness. Image parity,
production lighting and upload behavior need the real-city browser gate; these
tests do not establish physical-phone memory or performance. Metadata is supplied
for future picking and ground queries; it does not claim an existing UI picking
feature.
