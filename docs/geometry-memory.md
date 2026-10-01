# Lossless desktop geometry storage

`js/geometry-memory.js` wraps the public `slopes.add` boundary after builders, facade batching, stadium masks and apartment range bounds have finished. It changes only CPU retention of static appearance attributes. Position, normal, UV and index arrays remain resident for picking, bounds, collision diagnostics and future geometry readers. Phones retain their existing upload-release and reload policy; vertex packing is not enabled.

The uploaded attribute objects, types, normalized flags, counts, versions, indices and shaders are unchanged. After an actual `BufferAttribute.onUpload` callback, a bounded worker encodes identical whole tuples using their raw bits. Signed zero and NaN payloads survive; arrays without sufficient savings remain untouched. The original CPU array is released only after a successful response for the same attribute/version/source epoch. The previous upload callback runs first.

Reading `.array` synchronously reconstructs the exact original typed bytes. Attribute accessors, clone/serialization and a fresh renderer can read those bytes without asynchronous recovery or renderer changes. A read or setter during pending work invalidates that response. Ordinary cached uploads do not read `.array` in the pinned Three.js r159 implementation. Fresh-cache byte tests do not establish real context-loss recovery; this policy does not repair pre-existing shadow-target recovery problems.

Geometry disposal unregisters ownership without decoding packed bytes. The last owner's attribute keeps dormant lazy storage and its original upload callback, but leaves the active WeakMap and live accounting. Its getter decodes only when later touched; its setter can replace packed bytes without decoding. Re-adding reactivates the same storage and callback wrapper without eager hydration. Shared attributes remain active until their last tracked geometry is disposed.

Last-owner retirement unlinks queued jobs, clears the raw job alias and invalidates any busy response. Busy work keeps only a weak record reference on the main thread; its worker copy can finish or time out, but cannot restore retired ownership or overwrite a re-added source. Dormant storage is reachable through the attribute, not a global strong registry. A separately retained retired group can still retain dormant packed or already-raw bytes; disposal is not a fix for unrelated group caches. Idle workers terminate, and worker failure or timeout leaves sources usable.

`GpuMemory.tune` exposes the enable switch, minimum array bytes, minimum savings ratio, worker idle/timeout bounds and eligible attribute names. `?geometrymemory=0` disables this storage policy for A/B checks. `GpuMemory.stats()` reports active managed resident, compressed and saved view bytes without touching getters; dormant storage is excluded. These are not whole-process memory or proof that external backing-buffer aliases were collected. `GpuMemory.peek(attribute)` reads active or dormant storage without hydration, returning null when packed. Reading every `.array` in an old diagnostic materializes copies and invalidates its memory comparison.

## Static appearance contract

This policy is for immutable static appearance and fixed attribute membership, not transparent compatibility with arbitrary retained typed-array aliases. Compression followed by a getter creates a new array identity. Do not retain `.array`, a subarray/backing-buffer alias or a non-null `peek` result across upload/compression and later mutate it: those writes may target stale storage. `peek` is observational, not a mutable borrow; it does not invalidate pending work.

An immediate edit of the currently acquired `.array`, followed synchronously by `needsUpdate`, is supported; reacquire it for each later edit. Assigning `attribute.array` also invalidates packed/pending data, but Three still requires `needsUpdate` to upload replacements. The manager records membership at first track. Replacing/deleting appearance attributes after add is outside this contract: old records stay owned until disposal and new attributes are not automatically tracked. Finish recoloring, batching and masks before add, or explicitly dispose/untrack and re-add the geometry. Same-size/version upload fixtures validate immediate edits, not unrestricted alias-compatible mutation or live membership reconciliation.

## Verification

- `node scripts/verify/geometry-memory-codec.mjs`: bit-exact tuple encoding/decoding for supported typed arrays, offsets, signed zero, NaN payloads and rejection thresholds.
- `node scripts/verify/geometry-memory-lifecycle.mjs`: release only after upload, exact dormant getters/setters and packed re-add, allocation-free disposal, shared ownership, queued-job unlink, busy stale re-add, worker failures and phone exclusion.
- `node scripts/verify/geometry-memory-upload.mjs --source <local-three-r159-src>`: SHA-pinned actual uploader and BufferAttribute code with byte-recording GL; Float32/normalized Uint8, cached draws, ranged updates, replacement, dormant uploads and packed re-add without disposal hydration. Missing local sources produce SKIP with exit 77, not PASS.
- Full-city acceptance additionally requires matched second screenshots at campus, West Campus and downtown, day/night; exact pixel diffs; renderer/private-memory and CDP backing-store measurements; layer re-add, rebuild, area revisit and context-recovery checks. CPU fixtures alone do not establish visual or real-driver acceptance.

This policy targets settled CPU backing stores, not GPU allocation or a demonstrated startup-peak reduction.

Generic detach and reuse are unchanged. A separate permanent roof/art/dome retirement experiment was not retained because its real rebuild comparison failed the strict zero-pixel gate. Allocation-free handling of actual geometry disposal remains covered independently.
