# God's Eye View: useful parts for Austin

Assessment date: October 5, 2026. Upstream reviewed at
[`a08a53cf9469eb991f708bd3d042c327a2347e3c`](https://github.com/bilawalsidhu/gods-eye-view/tree/a08a53cf9469eb991f708bd3d042c327a2347e3c).
All upstream links below refer to that revision. This is a source inspection;
the verification record at the end separately records what actually ran.

**Keep it as a local research companion and adopt its camera/evidence workflow.
Do not replace Austin's renderer or import its whole application.** Its best
contribution is a second view of the real city, consistent geographic camera
records, and small tools for looking at references before modeling. Austin
already has more specific campus doors, walking surfaces, collision, apartment
and phone work than this global console. A wholesale port would add a server,
credentials, a different height system and large streaming budgets while
discarding that work.

## Where it would have helped

“Adopt now” means local development tooling. “Reference” means a useful pattern
or future implementation source, with no claim that it has been ported. “Defer”
means a feature that needs a separate product decision and acceptance pass.
“Leave” means it offers no worthwhile contribution to the current city.

| Austin task or recorded problem | Useful upstream source | Decision and limit |
| --- | --- | --- |
| DKR's tall drum, wrong deck hierarchy, southwest/northwest entrances and night appearance; [MAC_QUEUE.md](../MAC_QUEUE.md), `scripts/bake_stadium.py`, `js/slopes-stadium.js` | [3D reference capture][render], [aerial ortho][ortho], [Street View headings][headings] | **Adopt reference workflow now.** Check all four sides and overhead before authoring. Paid Google tools remain opt-in; supplied/current photographs remain stronger evidence for seating, stairs, fixtures and permanent appearance. Photogrammetry cannot establish the floodlight behavior or hidden concourses. |
| Campus and West Campus recognition: tower silhouettes, roof wings, balconies, window rhythm and frontages; `js/slopes.js`, `js/slopes-apartments.js`, `js/facades.js`, `scripts/fetch_roof_imagery.py`, [photo-five-realism.md](photo-five-realism.md) | [panorama reprojection][pinhole], [panorama acquisition][panorama], [3D reference capture][render] | **Adopt offline reprojection now; reference keyed tools.** A consistent heading/FOV makes comparisons useful. The mesh is a cross-check for massing, not a replacement for field-level recipes or owner photo detail. |
| Wrong or missing stairs, ramps, terraces, doors and sheltered approaches; `scripts/bake_entrances.py`, `js/entrances.js`, `js/campus-landscape.js`, [phone-structural-ground.md](phone-structural-ground.md) | [CCTV heading confidence][heading-confidence], [camera calibration][calibration], [ground guard][ground-guard] | **Reference.** Borrow the explicit separation of known position, estimated pose, calibration and surface clearance. Public cameras rarely see campus door details; a terrain sample cannot discover a tread count, walkable surface, railing or permanent doorway. Keep Austin's actual solid/floor ownership. |
| Camera altitude confused with metres per pixel, 256/512 tile conventions, low-eye zoom saturation and clipped facades; `js/controls.js`, [lowering-the-floor.md](camera/lowering-the-floor.md), [facades-measured.md](camera/facades-measured.md) | [explicit camera document][director-camera], [camera motion][camera-motion], [ground guard][ground-guard], [geoid conversion][geoid] | **Adopt explicit camera interchange now; reference runtime policies.** Record eye position, datum, orientation, effective vertical FOV and viewport. Cesium avoids MapLibre's center/zoom representation, but its height conventions do not automatically repair Austin's collision or projection constraints. |
| Opening flight took the camera back after input, “Walk it” and delayed arrivals fought navigation; `js/app.js`, `js/wayfind.js`, [intro-interrupt.md](intro-interrupt.md) | [camera arrival ownership][camera-arrival], [Director motion cancellation][camera-motion], [source replacement][source-slot] | **Reference.** Each arrival/move owns its callback, input revokes it, and stale asynchronous work cannot affect its successor. Austin has already fixed the documented intro fault; this is a design/checklist source for the next handoff, not a reason to replace the fix. |
| Slow reference capture and incomplete tiles mistaken for missing buildings; `scripts/verify/earth-reference.mjs`, `js/loader.js`, `js/app.js` | [progressive SSE capture][render-html], [target prewarm test][prewarm-test], [loading state][loading] | **Reference.** Warm the intended view, wait for the actual source/mesh and record unsettled state. Progressive SSE is useful for Cesium reference rendering; it is not a performance patch for Austin's PMTiles, GeoJSON parsing or Three.js meshes. |
| Per-frame repaint, animations continuing after use, style/area rebuilds and stale data; `js/app.js`, `js/graphics.js`, `js/geometry-memory.js`, `js/image-memory.js`, `js/lod.js` | [render governor][governor], [data lifecycle][lifecycle], [source replacement][source-slot], [bounded LOD][geojson-lod], [application teardown test][application-test] | **Reference.** Explicit animation owners, cancellation, bounded work and a full destroy contract are useful. Cesium's request-render switch cannot be pasted into MapLibre; hiding an entity does not free it. It does not solve Austin's exact GPU/context-recovery and buffer-ownership issues. |
| Evidence was labeled at building level, photos were compared at different poses, old imagery conflicted with current appearance; [photo-source-provenance.md](photo-source-provenance.md), private evidence store, existing recipe `sources`/`_src` | [panorama metadata tool][panorama], [data attribution][credits], [Director pack manifest][pack-manifest] | **Adopt workflow now.** Store date, actual viewpoint, source terms, uncertainty, field and superseded evidence. Upstream's panorama tool prints useful metadata but does not save a provenance sidecar; its capture alone does not meet Austin's policy. Private originals/precise camera positions stay outside Git. |
| Missing downtown buildings, bad massing or heights; `scripts/fetch_outer_osm.py`, `scripts/bake_lidar_heights.py`, `scripts/bake_lidar_raises.py`, [massing-from-lidar.md](massing-from-lidar.md) | [Google 3D stack][google3d], [keyless terrain][terrain], [height proxy][terrain-proxy] | **Reference.** Quickly inspect whether a silhouette/roof exists in another source and identify datum errors. Retain surveyed/LiDAR metric heights. Keyless terrain is regional terrain, not a high-detail building survey; a sampled photogrammetry roof is not surveyed ground. |
| Walking routes, mapped step-free paths, specific entrance identities, travel time and class/apartment finder; `js/walkgraph.js`, `js/wayfind.js`, `js/live-here-core.js`, `data/walk_graph.json`, [walk/graph.md](walk/graph.md) | [directions layer][directions], [route query][route-query] | **Leave campus routing implementation; reference route playback UI.** Austin's baked graph carries doors, steps, crossings, local topology and schedule semantics that a generic OSRM route does not. Use OSRM only for a separate citywide drive/bike/walk feature. A route returned or absent is not an accessibility certification. |
| Finding places and identifying new reference viewpoints; `js/wayfind.js`, `js/places.js`, `js/name-labels.js` | [keyless search][search], [Nominatim provider][nominatim], [place query][route-query] | **Reference.** Keyless coordinates/bundled names and bounded geocoding would help discovery. Preserve existing building aliases and entrance identity. Google Places results are capped and commercial terms apply; returned POIs do not establish doors, current tenants or comprehensive coverage. |
| Reproducible flyovers, scene presets and review/share views; `js/app.js` tours, `scripts/verify/pose.mjs`, JSON shot sets | [Director camera][director-camera], [scene document][scene-document], [validated sharing][sharing] | **Adopt camera records now; reference scene authoring.** Geographic anchors, exact destinations, shortest heading arcs, independent move/hold time and import validation are useful for later tours. A Director document does not automatically interoperate with Austin or prevent collisions. |
| Future live Austin context: CapMetro vehicles, bikeshare, public traffic cameras; `js/places.js`, static city scene and finder | [transit source][transit-source], [GBFS source][gbfs-source], [Austin CCTV catalog][cctv-config], [CCTV source][cctv-source] | **Defer runtime features; available in companion.** These are genuine Austin overlaps. They need timestamps, empty/stale/offline states, attribution, a server and phone acceptance. They do not verify pedestrian access or the intended permanent scene. Camera orientations/viewsheds are estimated and need calibration. |
| Future weather/context or dated city change reference; `js/sky.js`, `js/timeofday.js`, `js/city-lighting.js` | [observed weather query][weather-query], [recent imagery][recent-imagery], [weather source][weather-source] | **Defer runtime; reference in companion.** NOAA observations and dated NASA imagery can provide context. Regional imagery is too coarse for campus facade details. The authored sky/day/night scene is not current weather; preserving that distinction matters. |
| Repeat mistakes from broad tests, weak oracles, missing data and incompatible setup | [unit runner][unit-runner], [CI gates][ci], [application teardown test][application-test], [floor verification][floor-test], [component boundaries][boundaries] | **Adopt setup and scoped acceptance now; reference tests.** Pure policies, negative controls, independent height oracles and teardown checks improve future work. Retain Austin's real-page double captures, canceled graphics auto-detect, interleaved minimum timings and one-browser rule. Upstream's tests cannot establish Austin's correctness. |
| Military awareness, vessel tracking, rocket missions, global radio/SDR, ALPR mapping, submarine cables and Nepal flood story | [upstream catalog][catalog], [source terms][terms] | **Leave out of Austin.** They add little to campus realism/walking and bring unrelated UI, data, dependencies and licenses. They may remain available in the separate companion without being adopted or endorsed as project features. |
| Voice and agent-driven queries | [MCP surface][mcp-doc], [voice control][voice-control], [tool services][tool-services] | **Defer voice; keep MCP optional.** Local query tools could reduce research effort without putting providers into Austin. There is no need to alter global agent settings or send owner photos to voice services for this task. Any such use needs a separate explicit data choice. |

This is a map of plausible help, not a claim that having this repository earlier
would have prevented every failure. DKR, the camera handoffs and matched-photo
research have strong direct overlaps. Custom walkable solids, survey-quality
heights, the schedule finder and exact phone rendering remain Austin work.

## Camera interchange: the values must describe the same view

Austin's `js/controls.js` deliberately keeps the **eye** as state and derives
MapLibre center/zoom. Its current scene leaves terrain disabled and assumes
`transform.elevation === 0`. Its `alt` and building `final_height` are therefore
relative to the authored flat scene, not a measured WGS84 ground elevation.
Copying `alt: 1.8` into Cesium would put the eye 1.8 m above the ellipsoid,
typically underground in Austin.

| Value | Austin | God's Eye View / Cesium | Interchange rule |
| --- | --- | --- | --- |
| Position | Actual `__fly.eye()` longitude/latitude; map center is its derived look target | WGS84 eye longitude/latitude | Use eye coordinates. Do not relabel MapLibre center as the camera. |
| Height | Metres above Austin's flat authored zero | Metres above WGS84 ellipsoid in Director poses | Require an explicit ellipsoidal ground anchor at the eye coordinate; add Austin's relative eye height only when that local zero relationship is established. Record source and uncertainty. |
| Bearing/heading | 0 north, 90 east | 0 north, 90 east | Preserve the heading, normalize its wrap, and retain any camera roll. |
| Pitch | 0 straight down, 90 horizontal | −90 straight down, 0 horizontal | For the supported shared range, `cesiumPitch = maplibrePitch - 90`. Austin pitch 88 becomes Cesium −2 degrees. |
| Field of view | `map.getVerticalFieldOfView()`, degrees; live sprint kick can change it | `PerspectiveFrustum.fov` is the **horizontal** angle in landscape and vertical in portrait | Convert with aspect ratio; never pass the same number on the strength of the option name. Record the actual effective vertical angle. |
| Viewport | CSS dimensions and DPR, plus actual drawing buffer | Canvas dimensions/aspect and drawing buffer | Match composition in CSS/aspect, record both physical resolution and DPR, and verify the rendered result. |

For aspect ratio `a = width / height`, the Cesium frustum value matching an
Austin vertical angle `v` is `2 atan(a tan(v/2))` when `a > 1`; for `a <= 1`
use `v`. Angles in that expression are radians. At 1440×900, Austin's 58-degree
vertical FOV requires about **83.1393 degrees** as Cesium's landscape frustum
value. Upstream [`tools/README.md`][tools-readme] calls `cesium-render --fov`
vertical, but [`cesium-render.html`][render-html] writes it directly to
`frustum.fov`; the label is misleading at landscape aspect ratios. This was
checked against the installed Cesium 1.138.0 `PerspectiveFrustum` implementation.

The project camera helper requires a supplied `--ground-ellipsoid` anchor and
an eye JSON file; it rejects an implicit sea-level/default elevation. It emits
a reusable position/orientation link without fetching private photos or a height
service. The upstream share link does not carry FOV, so this link alone is not
a matched-framing export: set and record the effective FOV separately using
the conversion above. EGM96's `h = H + N` conversion is useful when the supplied orthometric
height really is referenced to that geoid. Austin's LiDAR/survey vertical datum
must be read from its metadata; NAVD88 cannot simply be renamed EGM96. Phone GPS
altitude and an unscaled photo are not suitable elevation anchors.

Cesium's runtime [ground guard][ground-guard] checks the actual rendered surface
after tiles arrive and cancels when the user takes over. Its default **120 m**
clearance is for globe arrivals, not an Austin 1.8 m walk. Do not copy that taste
value or treat a camera lift as evidence of the actual ground height.

## References and evidence

Use a supplied, rights-cleared equirectangular panorama with
[`pano-pinhole.mjs`][pinhole] for consistent perspective crops. It needs only
`sharp` and does no network or credential work. It assumes an equirectangular
projection whose center longitude is north and does not read Street View
heading/tilt metadata itself. An arbitrary phone panorama, rolled image or
unknown north direction needs calibration before a crop can be called a matched
view. Ordinary photographs should remain ordinary photographs; reprojection
cannot invent missing pixels.

Google acquisition tools are optional research code, not permission to archive
or redistribute Google imagery. A downloaded JPEG, a stitched panorama and a
scene screenshot retain provider terms. Do not commit their pixels or derive
new publishable datasets merely because the tool can save a file. Keep required
attribution in any permitted display and preserve acquisition date, actual
panorama location, orientation, source URL/ID privately where needed, terms and
what field the image establishes. No keyed request is required for setup or
the keyless smoke check.

Upstream panorama acquisition prints the selected panorama's date, actual
location, heading, tilt and copyright, which would have made old/different
viewpoints easier to notice. It saves only the JPEG, not that evidence record.
The headings tool similarly needs provenance captured separately. Any export
using them must satisfy [Austin's existing source policy](photo-source-provenance.md)
and reuse recipe `sources` and `_src`; it must not create a building-wide
“photo-built” badge.

Clear current owner photos/direct observations take priority for visible
appearance and stair counts. Surveyed/LiDAR measurements take priority for
metric heights. The owner's intended permanent scene state takes priority over
imagery of temporary works: omit the specified black barriers and EER tapestry,
keep its permanent window, and retain the last approved UT Tower appearance
until its intended finish is established. Trees, coverings and missing faces
remain unknown; extrapolation is labeled inference with its supporting fields.
Private originals, photo names and precise owner camera positions stay in the
private evidence store.

## Streaming and performance: useful technique, different budget

The standalone reference HTML begins at SSE 16 and refines through
16/12/8/6/4 to the requested value, waiting for tile stability at each step and
then pumping settling frames. This helps an isolated software-rendered Cesium
capture get enough detail without requesting everything at once. It is a
**readiness/quality strategy**, not a measured improvement to Austin startup or
frame rate. Its waits can exceed the CLI's outer timeout and some statistics
read Cesium private fields; a timeout must remain visible in the record.

The local/global LOD policy bounds active stems and sampling; its own comments
say that it does not reduce materialized entity count. The render governor
stops idle frames only when every animator holds/releases ownership and every
discrete mutation requests a frame. Those principles are useful for review of
Austin's loaders, `js/lod.js` and animation lifetimes, but a port needs measured
drawn-content acceptance and a MapLibre-specific implementation.

The [Google stack][google3d] uses **1536 MiB cache plus 1024 MiB overflow** in
its explicit tile factory. This is a ceiling/budget, not measured resident
memory, and is unsuitable as a proposed phone default. Its recorded [M5
baseline][performance] cannot predict the project's physical iPhone Safari
memory, thermal behavior or frame pacing. Keep Cesium, geoid grid, SDR, global
feeds and provider middleware out of Austin's shipped static bundle. The local
companion installation adds no site runtime dependency, no Google request at
page load and no change to phone profiles.

## Installation boundary and commands

The companion lives in **`~/Projects/gods-eye-view`**, outside the Austin
checkout, pinned to the reviewed revision. Austin's small helpers live under
`scripts/gods-eye/`: `setup.py` provides `setup`, `doctor`, `serve`, `tool`
and `smoke`; `camera.py` provides explicit camera conversion. They are local
development tools. They must not edit the city, export data into `data/`, modify
global agent settings or silently update the pinned upstream revision.

Use `python3 scripts/gods-eye/setup.py --help` and the subcommand help for
the complete supported options. `tool` selects only the audited upstream tools;
offline pinhole conversion is the default useful operation. Google capture and
acquisition are not exposed by this wrapper; they need the repairs below, an
explicitly supplied key/setup and separately permitted use. `serve` binds a free, explicit loopback port and should stop on interruption;
`smoke` owns and closes the server/browser it starts. The audited wrapper exposes only offline `pinhole`; keyed acquisition tools are linked as research references. Do not leave a companion
server or browser running at the end of a pass.

The lockfile resolves 203 npm packages, including platform-optional entries.
Direct packages at this revision:

| Runtime | Development |
| --- | --- |
| Cesium 1.138.0; EGM96 universal 1.1.1; hls.js 1.7.3; satellite.js 6.0.2; mgrs 2.1.0; pbf 5.1.2; @mapbox/vector-tile 3.0.0; @meri-imperiumi/eccodes-wasm 2.48.2; @jtarrio/signals 0.10.1; @jtarrio/webrtlsdr 3.0.6 | Vite 6.4.3; vite-plugin-cesium 1.2.23; sharp 0.35.4; Puppeteer 25.10.0; Prettier 3.9.6; ws 8.21.3 |

Supported Node engines are **24.14.0 or later in 24.x, or 26.x**. The current
machine already has Node 26.5.1, so this setup does not need another Node
installation. Use locked `npm ci`, with `PUPPETEER_SKIP_DOWNLOAD=1` when an
existing Chrome is selected; no duplicate browser download is needed. Install
hooks are present for Puppeteer, esbuild and platform-optional fsevents.
An install must report its own dependency/audit result; this inspection does not
claim the absence of known vulnerabilities.

Plain `npm run dev` reads explicit environment and checkout dotenv values and
starts keyless without Google/Cesium credentials: Esri satellite imagery,
Re:Earth/Mapterhorn terrain and OSM fallback. It does **not** provide a
photorealistic 3D city without a provider credential. Flights, public cameras,
earthquakes, satellites and several other feeds have keyless paths, but public
services can be unavailable or rate limited. Optional features remain off or
report missing keys. Installation success does not verify live upstream feeds.

Avoid upstream `dev-fresh.sh` for this isolated setup: it reads existing macOS
Keychain credentials and clears matching port processes. The project wrapper
should use an explicit environment and its own free port. The upstream doctor
normally checks Keychain item presence; its keyless report must disable that
lookup and use authoritative environment settings so it cannot report a
credential route the companion is not actually using. Credential values must
never enter logs, screenshots, committed configuration or lane mail.

## Security and source terms to retain

Upstream's application server already has useful same-site/Host checks,
registered-source fetching, response limits, cancellation, sanitized failures
and cost-endpoint throttles. Keep it loopback-only. The local [MCP route][mcp-plugin]
checks loopback peer/host/port, rejects forwarding headers and checks browser
Origin; it is local transport protection, not user authentication. Registering
it globally is optional and is not necessary to use the companion.

Its separate imagery tools do not inherit all those protections:

- [`cesium-render.mjs`][render] launches Chromium with
  `--disable-web-security`. Its HTML supplies a **detached credit container**,
  so its saved scene omits the required on-screen Google/Cesium attribution.
  Keep it out of public capture until repaired; an installed CLI is not an
  attribution-safe export.
- [`cesium-render.html`][render-html] takes the first finite sampled surface
  from nearby offsets and otherwise uses a **150 m fallback**. That sample can
  be a roof or a different surface. Its `--height` is relative to that sampled
  target surface, which can differ from ground under an offset look-at camera.
  Neither path establishes a surveyed eye height.
- [`streetview-headings.mjs`][headings] uses an undocumented Google internal
  metadata endpoint for `--neighbors`. Treat that path as fragile and exclude
  it from default acquisition. Do not silently broaden a keyed request.
- Tools accept `--key`, which can put credentials into shell history/process
  arguments. Prefer explicit environment/ignored private configuration; never
  include values in a tracked command or retained test output.

The [MIT license][license] covers upstream **code**, with the copyright/license
notice retained for substantial copied code. It does not license its images,
models or datasets. [DATA_SOURCES.md][terms] and [model notices][models] are part
of the decision to keep the app separate:

- TeleGeography cable data is CC BY-NC-SA 3.0. The Nepal/Bhote Koshi pack and
  derived coordinates compiled in `src/data/bhoteKoshiFloodPath.js` are
  CC BY-NC 4.0. Deleting its public images alone does not remove that restriction
  from a full build. Do not copy either dataset into Austin.
- Bundled OSM datacenters/dams/military names and relevant fixtures are ODbL,
  with attribution and applicable database access/share-alike duties. Code
  licensing does not erase those data duties.
- Google 3D/Street View/Places, Esri service access and Cesium ion use retain
  provider terms, quotas and on-screen attribution. The ion Community path is
  for eligible personal/noncommercial use; no eligibility is inferred here.
- OpenSky has noncommercial research/education terms. adsbdb route data has
  explicit copying/database restrictions and no generally published service
  license. Google News regional briefings have personal/noncommercial limits.
  Those global context feeds are not needed by Austin.
- Re:Earth/Mapterhorn terrain is CC BY 4.0; ECMWF data has CC BY 4.0 plus its
  stated terms/disclaimer. NOAA/USGS/NASA sources generally have public-data
  terms/courtesy credits, which still need to be read per product.
- Shipped 3D models have individual licenses recorded beside them. Third-party
  npm packages retain their individual licenses; Apache-2.0/BSD/MIT package
  notices are separate from scene data rights.

For OSRM/FOSSGIS, retain bounded fair interactive use and OSM attribution. Run
a service under appropriate terms for bulk use. Its generic network cannot
replace Austin's locally checked doors/steps and step-free claims.

## Verification record

Executed against upstream `a08a53cf9469eb991f708bd3d042c327a2347e3c`, with
Node 26.5.1. Dependencies remain in the separate companion. The install found
DOMPurify and source-map-js advisories; exact overrides to **3.4.16** and
**1.2.2** are in `scripts/gods-eye/dependency-overrides.json`. The resulting
lock is checked against the reviewed original on reruns; unreviewed changes
are refused. `npm audit --audit-level=low` reports **zero vulnerabilities**.
No provider credentials were configured or loaded for these checks.

- Installation and a second installation pass: pass, with source preservation
  and approved dependency overrides. Lifecycle scripts and duplicate Chrome
  downloads were disabled; installed esbuild/sharp worked in the actual build
  and projection check.
- Upstream `format:check`: pass, 1,210 source files. `check:boundaries`: pass.
- Upstream `npm test`: **5,619 passed, zero failed, one skipped** out of 5,620.
  The runner also skipped **two** allocation microbenchmarks calibrated for
  Node 24. This is a supported Node 26 pass, not the calibrated allocation gate.
- Upstream `npm run build`: pass. Its large-chunk warning remains; no produced
  bundle or non-commercial dataset was copied to the Austin site.
- Camera adapter: **14 tests passed**, covering eye versus target, explicit
  datum, pitch/heading, finite values, bounds and URL validation. It does not
  export FOV. The FOV conversion above was checked against the installed
  Cesium source, not an image-match acceptance test.
- Setup wrapper: **16 tests passed**, covering altered checkouts/dependency
  files, source preservation, provider exclusion, occupied ports, output
  privacy and cleanup races.
- Offline pinhole tool: passed using a synthetic equirectangular image.
  Output was 320×180; heading 0 versus 90 selected the expected distinct
  longitude band, and level pitch retained the horizon. No private or
  third-party photo was fetched for this test.
- Actual browser: pass on **Chrome 154 / SwiftShader, 1440×900, DPR 1**,
  keyless Esri + terrain. The UT campus aerial tiles finished loading, the
  specified eye/pitch/ellipsoidal altitude restored, Esri attribution stayed
  visible, no browser runtime errors occurred, and terminal destruction
  released the viewer, layers, render ownership and public debug handles.
  Two screenshots were taken; the second was inspected. Scratch images stay
  outside public Git because the imagery retains provider terms.
- Austin `harness-drift.mjs`: pass, **54 scripts in each page**. No city
  geometry, app script, terms page or runtime dependency changed. The new
  `gods-eye-tools.yml` runs the local helper gates; `visual-checks.yml` ignores
  only this new tooling folder, while mixed runtime PRs still run city checks.

The first browser oracle measured an empty-sized credit container instead of
its visible children; it was corrected and rerun. A dependency reinstall
while the page was loading invalidated another attempt. An interrupted attempt
left a browser process behind; it was removed and interruption now forwards
to the browser owner, which kills its process group. These failed attempts
are not counted as successful acceptance. Final viewer/server cleanup was
confirmed. No real hardware/phone timing, live transit/provider guarantee,
keyed Google capture, model improvement or runtime performance gain is claimed.

[render]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/tools/cesium-render.mjs
[render-html]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/tools/cesium-render.html
[ortho]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/tools/sat-ortho.mjs
[headings]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/tools/streetview-headings.mjs
[pinhole]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/tools/pano-pinhole.mjs
[panorama]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/tools/streetview-panorama.mjs
[heading-confidence]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/layers/cctv/headingConfidence.js
[calibration]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/layers/cctv/calibration.js
[ground-guard]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/cameraGroundGuard.js
[director-camera]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/docs/DIRECTOR-CAMERA.md
[camera-motion]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/scenes/cameraMotion.js
[camera-arrival]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/data/cameraArrival.js
[geoid]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/data/geoid.js
[prewarm-test]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/scripts/qa-view-target-prewarm.mjs
[loading]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/loadingFeedback.js
[governor]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/renderGovernor.js
[lifecycle]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/data/lifecycle.js
[source-slot]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/sources/sourceSlot.js
[geojson-lod]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/data/localGeojsonLod.js
[application-test]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/scripts/qa-application.mjs
[credits]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/data/dataCredits.js
[pack-manifest]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/director/packs/manifest.js
[google3d]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/maps/google3d.js
[terrain]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/maps/terrain.js
[terrain-proxy]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/server/providers/terrain.js
[directions]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/data/directions.js
[route-query]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/tools/queries/places.js
[search]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/search/index.js
[nominatim]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/server/providers/regional/place.js
[scene-document]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/docs/SCENE-DOCUMENT.md
[sharing]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/docs/DIRECTOR-SHARING.md
[transit-source]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/layers/transit/source.js
[gbfs-source]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/data/gbfsSource.js
[cctv-config]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/config/cctv_sources.austin.json
[cctv-source]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/layers/cctv/source.js
[weather-query]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/tools/queries/atmosphere.js
[recent-imagery]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/layers/recentImagery/index.js
[weather-source]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/layers/weather/source.js
[unit-runner]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/scripts/run-unit-tests.mjs
[ci]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/.github/workflows/ci.yml
[floor-test]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/scripts/qa-floor-verify.mjs
[boundaries]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/docs/CODE-BOUNDARIES.md
[catalog]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/tools/catalog.js
[mcp-doc]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/docs/TOOLS.md
[mcp-plugin]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/server/mcp/plugin.js
[voice-control]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/voice/control.js
[tool-services]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/src/tools/services.js
[tools-readme]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/tools/README.md
[performance]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/docs/PERFORMANCE.md
[license]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/LICENSE
[terms]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/DATA_SOURCES.md
[models]: https://github.com/bilawalsidhu/gods-eye-view/blob/a08a53cf9469eb991f708bd3d042c327a2347e3c/public/models/README.md
