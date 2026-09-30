# Facade input-copy memory boundary

`js/image-memory.js` releases only the redundant `userImage` reference for
generated static facade inputs. It preserves caller bytes and primary RGBA
pixels; it does not detach buffers or retire GPU textures.

## Audited source boundary

MapLibre GL JS **5.24.0**, distribution SHA-256:
`45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb`.
The actual pinned distribution's `Map.addImage` constructs its primary RGBA
storage with `new Uint8Array(input.data)` and separately keeps the original
object as `userImage`. `Map.updateImage` replaces primary RGBA pixels without
requiring the original static input reference.

Public upstream source references in `maplibre/maplibre-gl-js`, tag `v5.24.0`:

- `src/ui/map.ts`: `Map.addImage`, `Map.updateImage`, and the style snapshot
  path using `imageManager.cloneImages`.
- `src/render/image_manager.ts`: `getImages`, `_getImagesForIds`, `setLoaded`,
  `updateImage`, `cloneImages`, `removeImage`. Worker replies and snapshots clone
  primary RGBA data. Dynamic render and removal hooks still use `userImage`.
- `src/util/image.ts`: `RGBAImage` storage, replace and clone operations.

The optional distribution test executes extracted methods from that hash-checked
bundle, using small RGBA/style/event doubles. It does not evaluate the full
browser bundle or download sources. Extraction boundaries are hash-specific.

## Ownership

Only synchronous additions inside public `initFacades` and
`registerFacadeBuckets` wrappers are candidates. External additions remain
unchanged, including after an exception unwinds the wrapper.

Eligible inputs are ordinary or null-prototype objects with exactly the own
data properties `width`, `height`, `data`; full-buffer `Uint8Array` or
`Uint8ClampedArray`; exact `width * height * 4` bytes; matching primary RGBA
dimensions; and a different primary buffer. Caller objects and bytes survive.

Render/onAdd/onRemove hooks, inherited hooks, getters, class instances, extra
string/symbol keys, subarrays, shared buffers, wrong-sized inputs, failed adds,
unsupported versions and the phone profile retain their original ownership.
Releasing a reference is not proof that another cache or GC released its bytes.

`?imagememory=0` disables reclamation but allows eligible weak image/input pairs
to queue. Enable `ImageMemory.tune.on`, then call `ImageMemory.reclaim(map)` to
release still-matching candidates. Collected, removed, replaced or changed
candidates are discarded without releasing someone else's image.

## Node-only tests

```powershell
node scripts/verify/image-memory-lifecycle.mjs
$env:MAPLIBRE_DIST = './maplibre-gl.js'
node scripts/verify/image-memory-lifecycle.mjs
```

The optional environment variable names a local copy of the 5.24.0 distribution
the page loads. Without it the simulated suite runs and the distribution arm
explicitly skips. An incorrect supplied hash fails.

Both arms check caller/primary bytes after update, lazy worker replies requested
before registration, later worker replies, cloneImages, simulated restoration
into a fresh image manager, remove/re-add, exclusions, external ownership,
exception scope unwind and deferred reclamation. Deterministic VM weak-reference
doubles exercise dead candidates without forced GC.

Snapshot restoration here models retained image records, not actual WebGL
context loss or GPU atlas reconstruction. Paired city captures, real context
recovery, memory measurements and physical-phone results are separate acceptance
work. This suite launches no browser, downloads nothing and performs no Git writes.
