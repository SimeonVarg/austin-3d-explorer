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

## September 25 result and remaining blockers

Three complete interleaved pairs ran on hardware GL at CPU 1x, 1280x720, DPR 1,
with the balanced preset and the frozen route. Outside the 300 m Welch district,
owned CPU and GPU geometry each fell from 310,628,568 to 90,971,814 bytes, a 70.7%
reduction. Synchronous work before the first useful district view fell by
55.9%, 60.5% and 46.2%. These counters include coarse ownership and reconstruction;
they do not measure total browser memory or promise faster wall-clock loading.
Cold wall time ranged from 41.3-43.4 seconds for legacy and 36.4-60.8 seconds for
compiled loading.

The motion gate failed decisively. Legacy median frame intervals ranged from
18.00-18.40 ms; compiled intervals ranged from 28.20-36.10 ms. Legacy p95 ranged
from 28.60-30.40 ms; compiled p95 ranged from 56.40-63.90 ms. Every paired median
and p95 comparison exceeded the permitted 10% regression. The minimum and range
include all three repetitions; no slow sample was removed.

Individual upload slices stayed below 100 ms, but that does not clear the new-gap
gate. GDC preparation contributed 71.3-90.7 ms inside new 144.3-175.7 ms gaps;
additional long-task time remains unattributed. Each legacy and compiled route
had one heavy shared shadow-proxy rebuild. Compiled residency instead caused
246-284 sun-shadow passes versus 78 in legacy, as ownership changes invalidated
the two shadow cascades. Preserve those shadow updates until a replacement proves
equivalent caster coverage; suppressing them would hide work by leaving stale
shadows.

The admission planner also evicts small lower-priority details before discovering
that a later, larger victim alone would satisfy both byte caps. The recorded
corrected routes contain 1, 9 and 15 extra generation completions after these
avoidable evictions. Plan and prune the permitted victim set before disposing
anything. This bounded defect does not explain away the 71-80 distinct procedural
generations per route, GDC preparation or the wider shadow cost. Increasing the
budgets or changing the frozen route is not a correction.

The initial Welch round trip and the final 12-check actual-city lifecycle suite
pass. The final lifecycle run reports zero page errors, invalid GPU warnings or
old-context deletions, and no retained building owners after removal. Twelve
matched application poses preserve the inspected detailed targets, including
day/night glazing and Welch's grazing view. Distant coarse buildings visibly
lose fine facade detail. Painter has a matched daytime pose only; these captures
do not establish every building at every angle or physical-phone acceptance.

The next qualification must address admission churn, synchronous hero preparation
and the cost of correct shadow updates, then repeat the same three-pair route
and relevant lifecycle/visual checks. The current result remains a failed,
reviewable draft. It does not authorize catalog expansion or enabling the feature
by default.
