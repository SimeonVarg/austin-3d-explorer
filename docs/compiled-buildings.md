# Compiled building lifecycle

This first slice gives Welch, Painter, GDC, 2400 Nueces and The Standard
independent, versioned building assets inside the existing city. It preserves
the production geometry and materials. It does not introduce a new artistic
model, terrain, a replacement map renderer or a completed phone optimization.

The ordinary application keeps its existing renderer by default. Add
`?buildings=compiled` to `index.html` to select this slice; `?buildings=legacy`
selects the original whole-city builder. Both paths load the actual authored
catalog. There is no separate demonstration scene.

**Status: guarded draft, not accepted for rollout.** The September 25 actual-city
run passed the resource and synchronous-work gates, but failed both motion gates
in all three pairs. Lifecycle checks pass. Keep the feature flag and the current
five-building limit until the motion failures below are corrected and verified.

## Ownership and loading

The deterministic Node compiler and FBA1 format are documented in
[`scripts/buildings/README.md`](../scripts/buildings/README.md). Each building has
a stable source UUID, independently bounded parts, source and compiler hashes,
material descriptors, and provenance whose unknown measurements remain unknown.
The manifest is published atomically after all requested assets validate.
The default manifest URL is relative to the application page, so the worker's
asset requests also resolve under the GitHub Pages project path. Explicit
relative, absolute and root-relative manifest overrides remain supported.

`js/slopes-apartments.js` creates one conservative coarse object per authored
building, preserving its volumes, roofs, openings, recesses and balconies while
omitting small window frames, reveals and lettering. These objects remain owned
even while hidden by detailed replacements. This is a fallback policy for this
slice; a complete semantic near/mid/far design remains separate work.

`js/building-residency.js` selects nearby buildings and possible shadow casters.
It uses bounds in the existing Tower-centred east/north/up frame. The shadow
test extrudes the full building height along the current sun direction, without
an arbitrary low-sun distance cutoff. Terrain stays disabled. All rendering uses
the existing MapLibre camera, shared WebGL context, depth and lighting uniforms.

For the five compiled buildings, a module worker fetches a bounded response,
checks SHA-256 and decodes typed views into one transferred backing store. The
render adapter preserves attribute types and exact bits. Other nearby authored
buildings still use the existing generator, with paced work and independent
ownership; this milestone does not compile the remaining catalog offline.

Each geometry chunk is uploaded through the real shared Three renderer before
visibility. Texture uploads and mip creation get separate frame slices. The
zero-draw staging pass restores GL state and does not paint over the map. Only
after upload succeeds does a synchronous switch remove the old object and add
the replacement with the same building and compact picking IDs. A new root
shadow identity forces the shared shadow pass to account for the switch.

GDC retains its actual MapLibre hero features and Three roof underside. Its
adapter prepares a hidden source and layers, waits for source readiness and a
subsequent map render, then switches source opacity and underside ownership in
the same task. The original source remains available for restoration. The
lighting, shadow and collision integrations follow the currently owned source.
Compact picking IDs and metadata are foundations for later queries; they do not
constitute an existing authored-building picking interface.

## Budgets and failure behavior

`BUILDING_RESIDENCY_DEFAULTS` in `js/building-residency.js` holds all distance,
timing and resource choices. A `window.BUILDING_RESIDENCY` override can tune them
before initialization. Defaults are a 340 m detail radius at zoom 18.5, a
110 m retention margin, 320 MiB CPU ownership, 192 MiB GPU ownership, a 48 MiB
inactive asset cache and a 64 MiB per-building staging limit. Radius scaling is
bounded to 260–850 m. Default geometry chunks contain at most 8,192 triangles.

CPU accounting counts distinct backing buffers, including the complete decoded
asset owner, hidden coarse geometry, inactive assets and pending allocations.
GPU accounting uses distinct Three attribute owners and texture mip pyramids.
Transferred Float16 views are not copied by the render adapter. CPU and GPU
numbers are separate; merely hiding shared geometry earns no memory credit.

These are owned building-resource budgets, **not total browser memory limits**.
Shared map tiles, MapLibre's GDC buffers, shared shadow maps, JavaScript object
overhead and transient generator arrays are outside these counters. GDC's
MapLibre GPU bytes are explicitly unknown. The legacy renderer is measured with
the same authored-geometry denominator for the acceptance comparison.

Requests reserve known asset bytes before fetching. Resource pressure evicts
only lower-priority detail and retains its coarse object; it cannot make two
equally requested buildings repeatedly displace one another. A temporarily
unaffordable building is deferred without an asset-error backoff. Moving back
toward it lets it displace more distant detail. A hard per-asset size violation
remains an error.

Admission first projects the eligible victims in their existing order until
both CPU and GPU caps can be met. It then removes unnecessary victims from that
prefix before disposing any resident detail. The resulting set is inclusion
minimal within the selected prefix, not a global minimum-count eviction search.
An impossible individual admission call disposes no resident detail. Inactive
cache trimming still precedes planning; a later decoded-resource admission does
not roll back evictions made by an earlier successful CPU preflight call.

An invalid hash, truncated stream, missing file, bad URL, cancelled request or
failed replacement leaves the current object visible. A failed initial detail
load leaves its coarse representation visible. Asset failures use a retry delay;
an explicit retry can replace a source revision. A superseded request cannot
publish or overwrite the newer revision's cache entry. The inactive cache is
bounded and ordered by recent use.

Cancellation retains the worker slot and CPU reservation until the worker
acknowledges that it has released the response. This includes an in-progress
hash, which browser cryptography cannot abort. A result that races cancellation
is discarded before the next request is admitted. Queued requests have no byte
owner and cancel immediately; closing or losing the worker drains all requests.

Malformed manifests fall back to the authored catalog. Context listeners are
installed before the first asynchronous load: if the context disappears during
initial coarse construction, completed objects remain owned and generation
pauses until restoration. Aborted or failed initialization removes its listeners,
worker and completed geometry.

Rebuild, map removal and context loss cancel pending work. Rebuild waits for the
retiring controller before another build allocates resources. Disposal closes
the worker and drops owned geometries, materials, textures, sources and caches.
On desktop, context restoration reattaches the populated Three scene after
MapLibre rebuilds its style and removes custom layers. Existing scene and uniform
identities survive; pending uploads wait for the real renderer to return, with
cancellation and a bounded timeout. The residency queue pauses while the context
is lost and resumes after restoration. The scene's successful-frame counter also
survives restoration, preserving reveal readiness; a fresh scene starts at zero.
The shared lighting bridge discards destroyed GPU handles, recreates its fallback
shadow texture, and binds material/depth hooks to MapLibre's replacement painter.
It also cancels deferred shadow-proxy work and releases the old proxy while the
context is lost, before Three can carry its old buffer owners into restoration.
Removed maps release restoration listeners and timers as well as geometry.
GDC disposal distinguishes ordinary eviction from terminal map removal: eviction
restores the original source, while removal releases the adapter without trying
to rebuild a style that MapLibre has already destroyed.
The existing mobile recovery path is also corrected to suspend freed geometry
immediately and preserve its usable fallback after the one automatic reload.
Physical iPhone Safari/Chrome behavior remains unverified.

## Verification

Follow [`scripts/verify/README.md`](../scripts/verify/README.md), including the
shared GPU lock. Serve this checkout with `python scripts/serve.py <port>` and
set `VERIFY_URL`. Browser scripts require external `--out` directories. Use
hardware GL, one GPU worker, CPU throttling 1×, 1280×720 and DPR 1 for these gates.
Graphics auto-detection is cancelled; exposure, time and cameras are fixed.
Every accepted capture refreshes shadows and saves the second screenshot.

The CPU compiler and residency checks are listed in the compiler README.
`compiled-roundtrip.mjs` is the initial Welch gate: exact attributes, actual
GPU upload, matched day/night/grazing views and a missing-building negative
control. Complete this before expanding the compiled selection.

`compiled-hero-adapter.mjs` checks GDC's real source, underside, upload readiness,
atomic source changes, lighting, cancellation, replacement and restoration.
`compiled-lifecycle.mjs` exercises the actual full city, district travel, failed
and cancelled assets, cache reentry, rebuild, context restoration, page reload
and map disposal. Add `--initial-loss` to also interrupt real coarse construction
before its first publication. Restoration captures include day and night, and
invalid GPU-handle warnings fail the run. Add `--trace-deletes` to also reject
deletion of resources created before the current context generation.
`mobile-context-recovery.mjs` covers the separate mobile
recovery policy using desktop emulation; it is not physical-device acceptance.
`city-lighting-context-recovery.mjs` separately exercises cold-night fallback,
two losses, painter replacement and cleanup; its broken variants must fail.
`city-lighting-proxy-context.mjs` uses Three's real buffer owners to check proxy
release and identical shadow-volume reconstruction through two losses. Its
broken variant reproduces the invalid buffer deletion seen in the city.
`building-loader-cancellation.mjs` holds real worker hashing open and verifies
that cancellation retains both concurrency slots and residency reservations.
`building-hero-teardown.mjs` checks terminal disposal against the real hero host
alongside ordinary eviction and temporary style interruption.
`building-residency-paths.mjs` checks root and project deployments through the
real loader, worker and decoder, including query/hash URLs, manifest overrides
and missing-file fallback. Successful cases require the compiled hash to commit.

`compiled-baseline.mjs` records three cold legacy repetitions against the frozen
gate configuration. `compiled-performance.mjs` compares three fresh legacy and
compiled context pairs in interleaved AB/BA order, separating cold generation
from a warmed route. Both retain raw measurements. See the scripts' required
arguments; results and images belong in the external evidence directory.
The synchronous total includes generator calls, filtered-face planning and
rasterization, geometry/material assembly, decoded-asset reconstruction,
generated-object bounds/resource scans, and GDC's synchronous prepare/commit
work. These are disjoint phases with separate call counts; asynchronous waits
are excluded, while failed and cancelled synchronous work is retained. Remove
instrumentation routes before warming so Playwright does not disable the cache.
Readiness requires two fresh color frames after the last ownership change.

The frozen performance bar is at least 50% less resident authored geometry
outside a 300 m Welch district, at least 30% less synchronous generation and
finalization before its first useful view, no new warmed-route gap above 100 ms
attributable to decoding/upload, and no repeatable median or p95 frame-interval
regression above 10%. All repetitions and minimum/range remain visible. An
overlapping short upload does not explain a long existing shadow stall by
itself; raw traces require attribution before accepting that gate.
Repeated detail generation, ownership switches and extra render calls during
travel still count against the motion gate even when individual uploads stay
short. The post-route observation period and any unpainted boundary intervals
remain in the raw record rather than being silently discarded.

## September 25 planner follow-up and remaining blockers

The bounded planner correction was tested at
`ef77c4132a94332c7b714d5909b8ef10f7cdf4da`. It plans and prunes eligible victims
before disposal, retaining the existing budgets, protection rules, ordering,
pending ownership and coarse fallback. Nine additional resource contracts include
the exact byte fixtures from the prior admission audit, asymmetric CPU/GPU
pressure, impossible admissions and replacement ownership. All 31 residency
contracts pass; the old planner fails six of the new cases. The 11 real
worker-cancellation and six hero-teardown cases also pass: 48 relevant CPU checks
were rerun. Earlier compiler and deployment results remain historical evidence.

The remote data-bot advance was incorporated before testing. Every new arm loaded
the September 25 snapshot; the earlier run used September 22 data. The local
source and data hashes were identical before and after verification, and observed
requests identify 100 local data files, including worker fetches and all five
compiled assets. Authored catalog inputs, compiled payloads and the frozen
performance harness are unchanged from the preceding pass. Do not attribute
differences between those two passes solely to the planner fix.

Three complete interleaved legacy/compiled pairs ran sequentially on hardware GL,
CPU 1x, 1280x720, DPR 1, balanced graphics, from 23:26:10 to 23:42:20 UTC. The
route, thresholds, cameras, caps and shadow behavior were unchanged. Both motion
gates failed in all three pairs:

| Pair | Median legacy / compiled | p95 legacy / compiled | Synchronous startup reduction |
| --- | --- | --- | --- |
| 1 | 18.60 / 28.00 ms | 34.60 / 54.40 ms | 51.8% |
| 2 | 20.10 / 29.40 ms | 41.90 / 68.50 ms | 65.3% |
| 3 | 22.30 / 32.80 ms | 66.50 / 93.40 ms | 46.2% |

The minimum/range is 18.60-22.30 ms legacy versus 28.00-32.80 ms compiled for
median, and 34.60-66.50 versus 54.40-93.40 ms for p95. All six paired comparisons
exceed the permitted 10% regression. Cold wall time is 47.713-72.462 seconds for
legacy and 46.411-80.936 seconds for compiled; faster loading is not established.

The frozen outside-district geometry comparison remains 310,628,568 to 90,971,814
bytes for both CPU and GPU, a 70.7% reduction. The denominator is inherited from
the frozen per-building inventory. All three new legacy whole-group totals equal
347,931,522 bytes, and the healthy legacy build and authored inputs are unchanged;
the new harness does not independently remeasure the outside partition. The
frozen per-building inventory omits 53,436 bytes of separate filtered-facade
geometry included in the whole-group total. The original conservative denominator
and gates were retained. These are owned building geometry counters, not total
browser memory or known GDC MapLibre GPU bytes.

All 44 intervals over 100 ms remain in the audit: 15 legacy and 29 compiled,
including five start/end boundaries. Individual uploads stay below 100 ms
(maximum 24.2 ms), but the new-gap criterion is not cleared. Measured GDC prepare
slices take 60.6-76.9 ms inside 130.2-148.7 ms gaps; synchronous commit takes
29.8-40.3 ms outside those gaps. No recorded worker decode overlaps a long gap.
Other portions of long gaps remain unattributed. Named
main-thread scopes are unioned rather than added when nested, and inclusive
LongTask time is reported separately. Worker decode and asynchronous lifetimes
are not charged as main-thread work. The required stationary tail remains in the
gap record; its boundary intervals are already excluded from median/p95.

Compiled routes perform 218-278 sun-shadow passes versus 78 in each legacy run.
Each arm has one proxy rebuild over 100 ms; the many cheap proxy-function calls
are not additional heavy rebuilds. Ownership changes precede many shadow update
cycles, but this correlation does not assign all rendering cost to eviction.
Preserve correct caster coverage while investigating that cost.

The compiled traces contain 98/79/62 generation completions, 90/79/62 distinct
generated buildings, 8/0/0 within-trace repeat completions and 31/23/22 evictions.
The eight repeats comprise seven budget-deferred retries and one post-eviction
rebuild; the two runs with no within-trace repeats still fail both motion gates.
The independent byte audit finds no sufficient strict subset in the inferred
admission batches. That is not proof that every eviction was necessary: the
trace lacks exact pre-admission headroom and reasons, and the earlier warm route
is outside the repeat count. Correct planner contracts do not establish smooth
travel or eliminate generation and rendering costs.

The new actual-city lifecycle suite passes all 12 checks, including initial-build
context loss and terminal removal. Page errors, invalid GPU warnings and
old-context deletions are zero; all building owners reach zero after removal.
Its 562 unique warning/error console strings match the prior run, including
pre-existing caught arches/art initialization errors during style restoration.
Those subsystems are not covered by the building lifecycle acceptance checks.

All twelve matched application pairs were inspected. Nearby detailed targets,
day/night glazing and Welch's grazing pose are preserved at the captured views.
Distant coarse facades visibly lose fine detail and night emission. Painter has
a daytime pose only, and the Nueces target is substantially occluded. Stills do
not establish flicker acceptance or physical iPhone behavior.

The bounded pass stops here. Keep PR #312 as a guarded draft, the legacy default,
the five-building catalog and both failed motion gates. A separately authorized
next experiment is one matched legacy/compiled diagnostic pair on the same route
and data, sampling main-thread stacks and attributing garbage collection and
renderer/driver waits around the existing markers. It should explain unresolved
LongTask work and the more expensive ordinary colour calls while preserving
settings, geometry, caster coverage, caps and gates. Stop at that diagnosis;
it would not replace the three-pair acceptance experiment or authorize further
implementation or catalog expansion.

The preceding September 25 run at `ca8bbd94` is retained in local evidence with
all six runs, 22 long gaps and its failed motion verdict. It measured legacy
median 18.00-18.40 ms and compiled median 28.20-36.10 ms, with p95 28.60-30.40
versus 56.40-63.90 ms. Its byte audit supplied the regression fixtures for this
correction. The new same-data pairs above are the current qualification result.

## September 25 diagnostic follow-up (September 26 UTC)

The authorized next experiment is complete. Exactly one matched legacy/compiled
pair used the same September 25 snapshot, route and production source
`ef77c4132a94332c7b714d5909b8ef10f7cdf4da`, with hardware GL, CPU 1x,
1280x720, DPR 1 and balanced graphics. All 175 local data-file hashes, production
sources and frozen verification inputs match before and after capture. External
instrumentation was hashed separately. Both arms passed trace transport, clock
marker, CPU-profile and allocation-profile validation after disposable control
checks. No actual-city arm needed replacement.

The profiler requests 1 ms main-thread samples, 128 KiB allocation sampling
including collected objects, and a bounded trace. Sampling and tracing overhead
mean this pair cannot replace the unprofiled three-pair acceptance experiment.
Its median/p95 colour-frame intervals are 27.70/39.70 ms legacy and 42.10/75.10 ms
compiled. All 15 intervals over 100 ms are retained: six legacy and nine compiled,
including the legacy 427.4 ms end boundary. These are JavaScript colour-completion
intervals, not presented-frame or GPU-duration measurements.

The single recommended correction is **reuse of the zero-draw staging material
for its live renderer/context lifetime**. `uploadBuildingObject` in
`js/building-asset-runtime.js` creates a `MeshBasicMaterial` at line 185, renders
each part with a zero draw count at line 200, and disposes that material at line
217. The loaded Three r159 source releases a program when its final material
reference is disposed. In this pair, all 56 first-part staging renders contain
samples in `onFirstUse -> getProgramInfoLog`; none of the 36 later parts do.
First-part renders total 567.0 ms, versus 12.5 ms for later parts. This repeated
first-use path is a concrete avoidable cost candidate, not proof of how much a
future fix would save. First parts are classified by the first observed building
ID in the upload events; GL program identities and creation counts were not
instrumented.

The 92 staging renders total 579.5 ms and enclose 470.26 ms of disjoint
main-thread command-response waits. A 177.4 ms staging render, inside a 177.6 ms
upload and a 220.7 ms frame gap, has 105 of its 107 CPU sample points in
`getProgramInfoLog`; the longest nested wait is 174.66 ms. Nested scopes are not
added together. Whole-route command-response wait is 31.63 ms legacy versus
580.39 ms compiled. These are observed renderer-main-thread waits for command
responses; the evidence does not separate shader compilation, GPU backlog,
driver scheduling and transport latency, or establish GPU execution duration.

A future implementation of this one correction must retain program-error checks,
the zero draw count, geometry draw-range restoration, GL-state restoration,
per-part yielding, cancellation, caster coverage and existing budgets. Shared
staging ownership must survive ordinary building release while ending at the
owning renderer/context epoch's teardown. A cancelled building must not dispose
a staging resource another upload still uses. No such code change is part of
this diagnostic.

The recommendation does not explain or resolve the full steady-motion cost:

- Ordinary colour rendering totals 691.50 ms across 421 calls in legacy and
  1,354.40 ms across 284 calls in compiled mode: means of 1.64 and 4.77 ms.
  CPU samples show more per-object binding/uniform work and scene traversal.
  Sample counts are point observations, not elapsed CPU or GPU milliseconds.
- Correct sun-shadow rendering takes 78 calls / 77.20 ms legacy versus
  210 calls / 660.80 ms compiled. Ownership changes require caster updates;
  these measurements do not justify skipping or weakening those shadows.
- Each arm has one large shared proxy rebuild: 870.70 ms legacy and
  1,038.50 ms compiled. This is distinct from cheap proxy scheduling calls
  and ordinary shadow rendering. It occupies most of each arm's largest gap.
- Compiled generation slices total 997.00 ms; assembly totals 122.20 ms.
  Synchronous GDC preparation is 81.90 ms inside a 171.70 ms gap; its 32.50 ms
  commit and the 53.20 ms worker decode lie outside the long gaps. Worker decode
  is parallel work and is not charged as main-thread elapsed time.
- Main-thread GC trace intervals union to 245.23 ms legacy and 342.98 ms
  compiled. Estimated sampled allocations total 2.114 and 2.007 GB respectively,
  across their sampler windows. Fewer compiled colour frames reduce some shared
  map allocation activity while generation adds its own churn. These estimates
  do not measure retained heap, native/GPU allocation or per-gap allocation.
- The main-thread trace has 918.91 ms legacy and 59.73 ms compiled outside any
  recorded task interval. These remain unknown. Recorded script-call intervals
  can also contain opaque work or preemption; their full elapsed durations are
  not assigned to an ending CPU sample. Parallel worker/GPU tracks are not added
  to the main-thread partition.

The raw captures, exact source inventory, all-gap partitions and independent
source/sample reviews remain local. The previous three-pair motion failures are
still the qualification result. Keep the five-building opt-in catalog, legacy
default, PR #312 draft status, distant coarse-facade limitations and unverified
physical iPhone behavior. Stop after this diagnosis and one recommendation;
implementation, another profiling/acceptance pair, merging and deployment require
new direction.
