# Verification harness

Drives the **real** `index.html` in headless Chrome and asserts measurable
properties of the scene. This exists because this project has repeatedly been
burned by fixes that were shipped on reasoning alone and missed — see
`HANDOFF.md` §8. It lived in an ephemeral scratchpad once and was lost; that cost
real hours. It is in the repo now on purpose.

It is dev-only tooling. It adds no build step and no runtime dependency to the
site — the site is still plain static HTML/CSS/JS served from the repo root.

## Finder correctness (Node only)

`finder-correctness.mjs` runs the production route/schedule code in an isolated
VM with synthetic schedules, empty storage and fetches restricted to public
local graph/register JSON. It reads the public apartment catalog, exercises
normal and mapped-step-free walks in both directions, checks route arithmetic,
and compares synthetic graph searches with independent path-cost and fast-time
oracles. Imported review state is checked across parser, confirmation, minimal
storage and reload seams, including conflicting identities, clocks and calendar
fields. The suite also reverses schedule and apartment order in fresh VMs.
It never reads schedule images, private fixtures or browser storage.

From the repo root, with a recent Node supporting `Object.groupBy`:

```bash
node scripts/verify/finder-correctness.mjs --output <local-scratch>/finder.json
```

No npm install, browser, server or GPU slot is required. Omitting `--output`
prints the summary without saving the detailed matrix. Keep full JSON evidence
in local scratch, not tracked screenshot/output folders. To keep a timing run
undisturbed, set `FINDER_QUIET_PATH` to a marker file: the suite then pauses
between batches for as long as that file exists. Unset, it never waits.

Wrong identities, straight-line fallbacks, unit mistakes, omitted links and
regression failures cause a nonzero exit. Unavailable buildings/apartments and
walking/straight ratio outliers are reported separately: passing does not mean
all apartment entrances are mapped or current real-world access is verified.
The report records the graph hash and fails if it changes during verification.

A few groups pin today's coverage on purpose: SMC must be unroutable, HLB must
have no baked doors, and `wayfindSearch('Icon')` must contain `Ion Austin`.
When a bake adds SMC or HLB doors, update those assertions in the same change.
Jester West must resolve only to its own supported doors, not Jester East.
The ACS register alias is explicit and keeps the existing field-source door;
AF1 remains unavailable with its recorded reason. Identity recovery must not
accept a door away from its wall or a link cutting through its building.

## Setup

```bash
cd scripts/verify && npm install
```

That installs `playwright-core` only (no browser download — it uses your
installed Chrome). If Chrome is somewhere unusual, set `CHROME_PATH`.

**`npm install` is not optional and its absence is invisible.** The repo's own
checkout carried an EMPTY `scripts/verify/node_modules` on 2026-08-16 — the
directory existed, so nothing looked wrong, and every script in here died on
`Cannot find module 'playwright-core'`. A fresh worktree has no `node_modules`
at all. Run the install, or copy one in, before you conclude anything about a
script's health.

## Running

Serve the repo root on **a port nobody else is using** — never
`python -m http.server`, which has no directory scoping and will happily serve
another lane's worktree if it bound first:

```bash
python scripts/serve.py 8442        # from the repo root
```

Then, from `scripts/verify`, with `VERIFY_URL` pointing at that port:

```bash
VERIFY_URL=http://127.0.0.1:8442 node <script>
```

`BASE` in `chrome.mjs` reads `VERIFY_URL` and defaults to `:8099`. A script that
hardcodes a port is a bug — it measures whichever checkout answers first.

### Start here

```bash
node harness-drift.mjs        # PREFLIGHT. Text only, milliseconds, no browser.
node inventory.mjs            # what in this directory still runs at all
```

`harness-drift.mjs` runs from any working directory (it resolves the repo from
its own path). Put it first in any suite — every pixel number in this harness is
void if `_harness.html` and `index.html` have drifted apart.

`inventory.mjs` runs every script in here with a short budget and classifies it
CRASHES / FAILS / NEEDS-ARGS / PASSES / REACHES-BROWSER. Read its header for
what each bucket does and does not claim. **REACHES-BROWSER is not a pass** —
it means "still alive at the budget", nothing more.

To run these checks on a rented NVIDIA GPU instead of this one GPU browser (up
to four at once, frames brought back, session always stopped), see
`scripts/colab/README.md`.

### CI: the checks on every pull request

`.github/workflows/visual-checks.yml` runs this directory on GitHub's machines
for every pull request, and by hand from the Actions tab ("Run workflow",
optionally `only: sky.mjs,dusk.mjs`). It serves the pull request's own
checkout, runs the checks one at a time per machine across 8 Linux machines
on SwiftShader, and keeps **one comment** on the pull request up to date. The
check "Visual checks / summary" is red if any check did not pass. It never
pushes and holds no secret. Timing is not measured there. It is advisory:
nothing requires it to be green before a merge, and nobody should merge red.

Reading the comment, top to bottom:

- **Not passing** — each check that failed, timed out or could not run, the
  line of its output that says why, and a link to its shard's download: the
  full log and every picture the check wrote.
- **Pictures, before and after** — the ten views in `ci/poses.json`, shot from
  the base branch, from the pull request, and from the base branch again. A
  view is **changed** when more than 0.05% of its pixels moved AND that is over
  three times what the base branch moves against itself ("same page shot
  twice"). Name labels are OFF in these shots (`?namelabels=0`, `LOOK.shotQuery`
  in `ci/pictures.mjs`): since #326 the labels choose what to show from timing
  and from what they showed a moment ago, and two loads of main differed by up
  to 5.8% of a view. With them off, main against itself is 0%. Download the
  side-by-sides and open
  `index.html`: before | after | moved pixels in magenta, per view. Pictures
  never turn the run red: a visible change is usually the point of the pull
  request. They are there to look at.
- **Not run here** — quarantined checks and why, the timing scripts (laptop
  only), and the tools that have no verdict to give.
- **Graphics probes** — the renderer Chrome gets and the frames per second the
  city draws, on the Linux runner and on a macOS runner, with screenshots.

**Why so much is quarantined: the runners have no GPU and are slow at
software rendering.** Measured 2026-09-27 at the spawn view: SwiftShader draws
**0.2-0.6 frames a second** on a 4-core Linux runner (3.7 on the laptop),
0.16 on Windows. Every single-frame pixel check is fine and reproduces the
laptop's own numbers exactly; anything that needs the camera to move or the
scene to settle inside its own 60 s window cannot. Those are quarantined as
"needs a GPU". A macOS runner does have one: full Chrome gets **Apple's
paravirtual Metal GPU at 22-34 frames a second** — the place for them, later.
CI gives Playwright's own waits more room (`ci/slow-machine.mjs`): its 30 s
default becomes 180 s and a load/wait timeout a script names is tripled. No
assertion, threshold or in-page timer is touched. The one retry is for Chrome
failing to capture a screenshot at all, and the comment says when it happened.

**What runs is `ci/checks.json`.** Every top-level `*.mjs` here runs unless it
is listed there under `quarantine`, `laptop_only`, `tools` or `harness`, each
with a reason. So a new check is covered the day it lands, and leaving one out
is a visible line. Arguments (`{out}` becomes the script's own artifact folder)
and ceilings go in its `run` entry. To bring a quarantined check back, fix it,
delete its line, and let the pull request's run show it green.

Reproduce one shard's way of running a check locally (it never reaps browsers
outside CI): `VERIFY_URL=http://127.0.0.1:8442 node ci/run-checks.mjs --only
sky.mjs --out <scratch>`.

### The core gates

```bash
node movement.mjs      # camera: symmetry, vertical control, momentum, stuck keys (14 assertions)
node collision.mjs     # never inside a building, streets stay flyable, joystick+look (8 assertions)
node walk.mjs          # a scripted walk really walks, at 1.7 m, and can be watched failing
node sky.mjs           # one-sun coherence, disc projection, blend invariants (12 assertions)
node sunset-band.mjs --url=<origin>  # composited phone/desktop sunset horizon: coolest clear column R-B >= 90
node dusk.mjs          # the dusk handover is continuous, measured in PIXELS across a p sweep
node night-silhouette.mjs   # the skyline reads DARK against the sky at dusk and night
node banding.mjs       # the sky gradient is still a gradient + updateSky cost
node shot.mjs <prefix> [shots.json]   # screenshots at named camera poses
```

`movement.mjs`, `dusk.mjs` and `banding.mjs` accept `--report` to print the
table without failing.

### The lidar height knob: what is drawn, and before/after frames

`final_height` is only the height of the plain prism, so a roof height compared
with it is compared with something that is often not on screen (authored
meshes, West Campus bands, heroes, parts, pitched roofs hide or bury it).

- `drawn-heights.mjs <out.json> [query]` loads the app (real GPU, veil gone,
  authored meshes ready) and dumps every extrusion feature that can be a
  building, the authored meshes' own tops and the prism hide list, with no
  screenshot. `python scripts/lidar_drawn.py <out.json> <drawn.json>` joins it to
  the footprints: `drawn_h` and `path` per building.
- `lidar-shots.mjs <outDir> <shots.json>` shoots the same camera with
  `?lidarheights=0` (the snapshot's heights) then the default page (the scan's
  raises) in ONE browser, retries a failed capture with the cause logged, fails
  if the default leg changed no height, and writes `proof.json` with the
  `final_height` the renderer drew for each probed building. It refuses to run on
  SwiftShader (every earlier run of it timed out at 30 s there).

Both want `VERIFY_GL=hardware` and go through `gpu-run.mjs`; frames belong in a
scratch folder, not the repo.

### Full-city context recovery

`VERIFY_URL=http://127.0.0.1:8442 node device-recovery.mjs --out <outside-repo-directory>`
loads the normal city with the natural touch performance profile. It requires
all 196 buildings before injecting actual shared-canvas context loss during
time-of-day playback, observes restoration and one recovery reload, and checks
resumed keyboard and touch-joystick movement plus portrait, landscape and
2560 x 1440 DPR1 captures.
Console errors, extra reloads, wrong viewport metrics and partial cities fail.
`--break-injection` deliberately omits loss and must exit 1 with
`No actual context-loss event observed`. Reports and second screenshots go to
the required external scratch directory. This is desktop Chromium emulation,
not physical iPhone, memory, thermal or performance acceptance. The large view
retains the touch graphics profile; it is not a fresh desktop-default session.

### The paced facade repaint paints the same bytes

`node facade-pace.mjs` (no browser, no server) assembles the facade paint
worker from `js/facades.js`'s own function text the way `pacePool` does, runs
it in a sandbox with the real `js/pattern-lowpass.js`, and checks that every
tier image it returns is byte-identical to what `tileData` makes on the main
thread for the same drawing (template and measured tile sizes, mottle on and
off), that its premultiplied copies equal MapLibre 5.24.0's `El` for all
65,536 alpha/colour pairs, that a paced patch into a tile built mid-job
rewrites exactly the 1-texel wrap border a fresh atlas has (and only then),
and that the PACE knobs are named. `--break` widens the worker's blur by one
texel, `--break-border` switches the border rewrite off; each must exit 1. It does not check timing or
the scheduler; the frame-time A/B for the pacing is in HANDOFF (Sep 24 2026).

### Phone memory, and the reload loop (Sep 24 2026)

`node mobile-memory.mjs --arms main=http://127.0.0.1:8872,branch=http://127.0.0.1:8871 --reps 3`
loads the phone profile (390x844, DPR 3, touch, iPhone UA, hardware GL, a fresh
browser per rep, arms interleaved) and reads once a second until 30 s after the
authored buildings land: the JS heap and ArrayBuffer backing store
(`Runtime.getHeapUsage`), every live WebGL texture, buffer and renderbuffer
(counted in the page, with the allocating file), and the renderer and GPU
processes' private bytes and working set. `phone` = heap + backing + GL is the
headline: what the page holds, independent of this laptop's GPU driver. It
prints the PEAK (the opening flight is the peak) and the SETTLED value, the
minimum over reps. An arm URL may carry its own query
(`lighter=http://127.0.0.1:8871/?drift=0&litetier=lighter`); `--desktop`
measures 1280x800 instead. It is a measurement and exits 0. Desktop Chrome
is not WebKit: the numbers rank changes, they do not predict an iPhone's kill.

`mobile-boot.mjs crashloop ctxintro` are the reload-loop gates: a renderer
killed during the opening flight must come back (as Safari's one automatic
reload would) on the `lighter` tier with the authored buildings and never
reload itself, and a context lost during the flight must reload exactly once,
onto the `lighter` tier, and not again when it is lost a second time.

### A graphics reset pauses the phone city, it never leaves it hollow (Sep 27 2026)

`VERIFY_URL=http://127.0.0.1:8871 node scene-unavailable.mjs [early|intro|storage|nodialog] [--out DIR]`
(hardware GL, one browser, 390x844 DPR 3 touch). A phone drops its vertex
arrays once they are on the GPU, so a restored context cannot draw the city
again; only a new document can. Three real losses: before the three.js root
exists (the style request held), a second loss after the flight's one
automatic reload, and a loss whose reload record cannot be written. Each must
end PAUSED (nine checks: `LITE_PROFILE.sceneUnavailable`, no controller, every
walking support 0, a native modal with no dismiss, the root hidden, frames
stopped, the camera unmoved through W + Escape, no errors), and the real
"Reload city" button must bring back a WHOLE city (196 buildings, all 35
supports incl. the 10 on Gearing's authored model, released CPU arrays, draw
calls, a hardware renderer) that moves under the keyboard. `nodialog` deletes
`showModal` (Safari before 15.4) and requires the automatic reload to still
happen. `--break` makes the
flag impossible to set in the page and must exit 1 (Sep 27: it does — 35/35
supports still answer over a city whose buffers are gone, and the card can be
dismissed). Codex's negative control of the unmodified Sep 24 code (private,
`pr310-recovery-spike`) found the same hollow city with its controller still
live and zero page errors: nothing else in this directory noticed.

`VERIFY_GPU=low` swaps `--force_high_performance_gpu` for
`--force_low_power_gpu` in every hardware launch (`chrome.mjs` `HW_ARGS`):
the owner's laptop has an AMD iGPU next to an RTX 3050 Ti, and a visitor
without the big GPU is the one to measure. Print the renderer string.


### The shadow proxy is never rebuilt mid-flight

`node shadow-proxy-pacing.mjs` (no browser, no server) runs the real
`shadowProxy` code from `js/city-lighting.js` against a scripted map: a 12 s
flight of per-frame `jumpTo` moves with a tile landing mid-flight, the flycam
still owning a parked camera, a 2.5 fps flight, an ease, and moves that do and
do not change the drawn tile set. Nothing may rebuild while the camera moves;
exactly one rebuild once it has been still for `settleMs`, containing what
landed mid-flight; a move that changes no input is checked but not rebuilt.
`--break` restores "rebuild 300 ms after any move" and must exit 1. (Until
2026-09-23 every moveend rebuilt it, 1.0-1.4 s each, every ~1.5 s of a flight.)

The same gate then builds 350 authored apartments one by one with the camera
still, as the time-sliced build does under the veil: no rebuild, because the
proxy reads none of that progress. The build landing, an area attaching, the
apartments switch and a new `buildings-3d` hide list each rebuild it once, and
a footprint over a caster's centre takes that caster out. `--break-storm`
restores "rebuild whenever `count.buildings` moves" and must exit 1 (it rebuilds
116 times in the 35 s build). Until 2026-09-28 that was the code: 9 rebuilds,
7.8 s of main thread, 17 % of the load under the veil.

`node shadow-proxy-recovery.mjs`: while the map has no style, or a style that
has not loaded, the rebuild stays pending instead of building from nothing.
`--break` drops the "not loaded" half and must exit 1.

`node shadow-proxy-slices.mjs` (no browser, no server): the rebuild runs in
slices (`PROXY_PACE.budgetMs`), so the still picture keeps drawing while the
proxy is rebuilt after a turn. Against a scripted map whose tile queries each
cost 30 ms of the test clock: a sliced build takes several tasks and no slice
runs longer than one query past its budget; its triangles are byte for byte
the one-piece build's; a camera moving mid-build pauses it and, still again
with the same tiles, it resumes without a second start; tiles changing during
the pause restart it once and the result has them; the proxy arrives with its
bounding sphere. With 250 ms frames between slices (a loaded machine) the
slices stretch (`stretchMs`, `maxBudgetMs`): fixed 5 ms slices took 13.1 s of
test clock, stretched ones 5.6 s, the longest 42 ms, same bytes. (In a real
page on a loaded machine one fixed-slice build took 52 s.) `--break` builds in
one piece and must exit 1.

### What turning costs: `turnmeter.mjs`

`node turnmeter.mjs --arms base=http://127.0.0.1:8977,branch=http://127.0.0.1:8978 --reps 3 --vsync off`
drives the real `index.html` the way a person turns (W held, the mouse dragging
the view) at 60 and 120 deg/s, three 180-degree flicks in 0.5 s, and three
quick looks without W, each against a straight flight of the same length from
the same pose, at the campus spawn and over downtown. Arms run interleaved
(A,B then B,A), a fresh browser and a fresh load each. Per scenario: frame
interval p50 / p95 / worst, frames over 50 ms, long tasks, MapLibre's and the
three.js layer's CPU per frame, shadow-map re-renders, tiles that landed (per
source in `tilesBy`), facade atlas uploads (`atlas`, the main-thread texture
prep in `js/facades.js`, counted in the drive and in the stop), the
yaw actually achieved, and "stop": the worst frame gap in the 2.5 s after the
hand lets go. `--gpu low` for the AMD iGPU, `--gputime` for GPU time per frame,
`--profile` for a sampled CPU profile per scenario (`--profile split` profiles
the drive and the stop separately), `--video DIR` to record
(each scenario's `videoAt` is its window in seconds into that recording).
An arm can carry its own URL switches after a `|`, so one checkout can be
A/B'd against itself:
`--arms "far20=http://127.0.0.1:8978|shadowsnapfar=20,far100=http://127.0.0.1:8978|shadowsnapfar=100"`.

Four traps, all met building it:

- **`--gpu low` can still draw on NVIDIA.** Windows' per-app GPU preference
  (Settings > Display > Graphics) beats Chrome's `--force_low_power_gpu`, and
  the installed `chrome.exe` on the owner's laptop is set to High performance.
  turnmeter now exits 2 when a `--gpu low` run reads an NVIDIA renderer. Run
  the AMD arm with `CHROME_PATH` pointing at a browser with no preference set
  (Edge worked; Playwright's own chromium would not spawn on this machine).

- **Headed, vsync off.** With the laptop's screen asleep a headed window gets
  about one frame a second from Chrome, and a headless one stops firing rAF.
  `--vsync off` (`--disable-gpu-vsync --disable-frame-rate-limit`) makes a frame
  interval the frame's real cost, not a multiple of 16.7 ms.
- **The first turn is not like the others.** Most of the scene is outside the
  spawn view, so the first frame that looks at it built its shader programs:
  one 0.8-1.4 s frame, on the first campus turn only. A run that warms up with
  a turn before measuring never sees it; this one measures from a fresh load.
- **The flycam moves the map with one `jumpTo` per frame**, so every frame
  ends in a `moveend` and MapLibre fires `idle` mid-flight. Anything keyed to
  `moveend` or `idle` (lamp discovery, the old proxy rebuild) runs DURING a
  turn unless it also checks `window.__fly.eye().driving`.

### Facade atlas prep in MapLibre's workers: `atlas-worker-pm.mjs`

`VERIFY_URL=http://127.0.0.1:8562 node atlas-worker-pm.mjs [--break | --break-img]`
(laptop, hardware GL, through `gpu-run.mjs`). Two things moved off the main
thread in `js/facades.js` and both must be byte-exact: each tile's pattern
atlas is premultiplied inside the MapLibre worker that built it
(`ATLAS_WORKER_PM`), and each worker keeps the pattern images it was sent, so
this thread sends a stub instead of a fresh copy when the worker already holds
the same image at the same version (`ATLAS_IMAGE_CACHE`). The page is loaded
with `?atlaspmcheck=1`, which makes every worker atlas carry its raw bytes and
every stub carry a fresh copy beside it, and the camera is turned through a
full circle at campus and downtown. PASS needs every atlas and every held
image compared, 0 bytes different. `--break` (a worker that tags an atlas
without premultiplying it) and `--break-img` (held images corrupted) each exit
1. `facade-atlas-memory.mjs` runs the same worker source text in a vm, in CI.
`?atlasworkerpm=0` and `?atlasimgcache=0` switch either half off for an A/B.
`turnmeter.mjs` prints `wpm` (atlases premultiplied in a worker), `pm` (main-
thread premultiply ms), `held` (images a worker already held) and `gi` (the
main-thread image copies it still made) per scenario.

### The authored-footprint test is a grid, and gives the scan's answer

`node proxy-inside-grid.mjs` (no browser, no server) runs the real
`footprintLookup` from `js/city-lighting.js` against every authored footprint
(core, then core + every on-demand area) and compares it, point by point, with
the scan it replaced (`rings.some(inside)`): the centre of every legacy prism,
part and outer-ring building, an 8 x 8 lattice over every footprint, its
vertices, points one rounding step either side of its box and on cell edges,
and odd rings (a broken vertex, an empty ring, a 40 km box, a NaN centre). Any
difference fails. `--break` files no ring under its last cell and must exit 1.
On 2026-09-28: 0 differences over 21,066 caster centres (against both
footprint sets) and 50,240 lattice and edge points; the scan took 2.1 s for
the caster centres against core + Riverside, the grid 27 ms.

### Far-away authored buildings load when the camera goes there

`node apartment-areas.mjs` (no browser, no server) runs the real
`js/slopes-apartments.js` in a sandbox with the geometry stubbed, against an
index with one core file, one core collection and one on-demand area. The
start must request no area file and be ready without it; a camera within
`APARTMENTS.areas.loadM` builds the area as its own group, and only then do its
buildings join the catalog and hide the outer ring's boxes; a desktop keeps it
when the camera leaves, a phone drops it past `unloadM` with the boxes, counts
and catalog back to the core's; `ensureAt` builds ahead of the camera; a core
rebuild takes areas down and back without double counting; an area dropped
mid-build takes back its counts; `?areas=eager` is the old start; a phone's
chunked build gives the area one mesh per chunk, like the core; and a phone
paused by a lost WebGL context (`LITE_PROFILE.sceneUnavailable`) builds no
area. `--break`
makes every area eager (Riverside at start again) and must exit 1. It does not
measure load time or memory; those numbers are in HANDOFF (Sep 27 2026,
Riverside).

### The "graphics acceleration is off" notice

`VERIFY_URL=http://127.0.0.1:8442 node gpu-hint.mjs --out <outside-repo-directory>`
checks `js/gpu-hint.js` in six cases across a hardware and a SwiftShader
browser: no notice on a real GPU, no notice and **no GL query at all** under
`navigator.webdriver` (every other script in this directory), none with
`?gpuhint=0`, a notice on the real software-renderer path with the webdriver
flag hidden (then dismiss, reload, still gone), and `?gpuhint=1` at 1440x900
and 390x844, inside the frame and clear of the title pill and buttons.
`--break` reports a GPU renderer string to the page and must exit 1.

The notice stands down under `navigator.webdriver` on purpose: this suite runs
SwiftShader for exact pixels, and a card over the city would move every one.

### A broken browser cache must not take a map layer with it (Oct 4 2026)

`node tile-heal-source.mjs` (no browser, no server) runs the real `js/tiles.js`
against the real pmtiles library (the build `index.html` names, fetched once and
kept in the temp folder; `PMTILES_JS=<file>` uses a local copy) and the real
`data/tiles/props.pmtiles`. Only the network is fake, and it models the incident:
a cache that answers a NORMAL read of a range with a 206 of the right length
whose bytes are all zero, while a `cache: 'reload'` read gets the file. It
asserts 35 things: with the heal off the archive fails to open (so the fake
reproduces the incident); a zero-filled header range is healed by a reload in the
same load, with the real tile and one console line naming the archive; a cache
that keeps the bad copy after the reload moves the archive to `?cg=1`, stores the
generation, and the next load opens on it without a bad read; a stored generation
is read strictly (integer, 1..99, written as `String(n)`); a bad reload, a
hopeless archive (one console error, bounded requests, nothing stored), a bad
tile range, a header of garbage or of another spec version, a zero-filled root
directory, a root directory or a tile with a zeroed end, a short read, blocked
storage, three bad reads at once (one move, not three); a healthy archive makes
exactly the requests it made before; and every directory, metadata block and tile
of all five real archives (2,944 ranges) passes the check, so it has no false
positive on what the site serves.
`--break` loads `tiles.js` with `?tileheal=0` (the code path before the heal) and
must exit 1 (4/35 pass: the control and the checks that nothing changed);
`--tiles <file>` runs the same scenarios against another copy of `tiles.js`
(`origin/main`'s: also red). Ten hand-made breakages of the heal itself (no
generation when a reload does not stick, lax generation parsing, a generation
stored on failure, no once-only move, no gzip rule, no zeroed-end rule, no
gzip-magic rule, no zero rule on the header, a reload that reads from the cache,
no check at all) were each caught.

`VERIFY_URL=http://127.0.0.1:8442 node tile-heal.mjs [--break] [--out DIR]`
(laptop, through the browser queue; `_harness.html`, one load) is the same
incident in a real page. It intercepts the first range of `outer`, `roads` and
`props` and answers a normal read with a zero-filled copy of the real 206; a
cache-bypassing read and a `?cg=` URL get the real bytes. `outer` and `props`
repair on a reload, `roads` does not (so it must move to `?cg=1`). Then, from the
one page: the poison was really served; one navigation; each archive healed the
way it should and one console line names it; and the DRAWN result: decoded
features in the far ring's and the roads' tile caches AND the frame moves when
the layers of that source are hidden, beyond the noise floor of the same state
shot first, second and last (a downtown pose; screenshots, counted in the page).
Measured 2026-10-04, map pixels only, labels off: noise 0.000%, far ring 60.3%,
roads 0.261% on the laptop and 0.235% on the build server (floors 10% and
0.08%), the two hidden frames 60.6% apart; all 16 pass. With the heal off
(`--break`, `?tileheal=0`, exit 1) 5 of 16 pass: bare ground, zero decoded
features, and every share is exactly 0.000%. **The first version of this check
was wrong and the build server caught it:** it reported roads 8.1% and set a 1%
floor from that, and with the heal off it "measured" 13.2% for both layers.
Neither number was the layer (see the last two traps below); the server, where
the timing fell differently, measured the true 0.235% and failed the floor.
Five traps in it:
Playwright's interception sits above the HTTP cache, so the `Cache-Control:
no-cache` / `Pragma: no-cache` Chrome adds to a `cache: 'reload'` fetch are not on
the request the route is shown (a one-line shim copies the page's own `cache`
option into a header); and `route.fetch` opens its own connections, so a burst of
tile reads through it overflowed the local server's listen queue
(`ECONNREFUSED`): only the poisoned reads go through it, the rest `continue()`.
And the loading veil sits over the map and animates, so a page screenshot of an
un-pinned page measured the veil (97% "noise" on the first run): the script
removes it, pins auto-exposure, grain and star twinkle, and the drawn checks are
net of the measured noise. Fourth: **taking the veil element away does not end
the veil's reduced render scale.** The app draws soft until its own `reveal()`
(`INTRO.veilRenderScale`, js/app.js), so the frame went from soft to sharp by
itself between two shots; the "same state twice" pair was taken before the jump
and read 0.003%, and the jump was then counted as a layer. Pin
`window.__veilRenderScale = 1` (then `applyGraphics()`) in any test that removes
the veil, and shoot the first state again LAST: a noise floor measured only at
the start cannot see a frame that changes later. Fifth: page furniture arrives
late (a "Switch modes" pill appeared mid-run and moved 0.2-0.5% of the frame, as
much as the roads) and labels cross-fade when a layer is toggled, so the shots
hide everything but the canvas with one CSS rule and switch symbol layers off.

### Exit codes mean something

`0` the assertions passed. `1` an assertion failed. `2` the script could not
run — bad or missing arguments. `124` the `chrome.mjs` watchdog killed it.
Anything else is a crash. Before 2026-08-16 several scripts printed `*FAIL` and
then exited `0`, so nothing in here could be automated; if you add a script,
make its exit code its verdict.

### Every gate must be watchable failing

Several scripts take `--break`, which sabotages the thing they guard **inside
the page only** (no file on disk changes) and must come back red:

```bash
node dusk.mjs --break              # a step discontinuity patched into skyBodies
node banding.mjs --break           # the sky overlay hidden
node night-silhouette.mjs --break  # building walls forced to #f2f2f2
node westcampus-probe.mjs --break  # one of the three wc- layers hidden
node walk.mjs                      # ships its own watched failure, see §145
node coplanar.mjs --selftest       # eight assertions; makes itself fail
node night-compare.mjs --selftest  # the MEASURING half; 22 assertions, 7 sabotages
```

`night-compare.mjs` is the newest of these and the only one whose `--break` is not a
bare one-liner: the tool takes no default `--out`, and `--break` sabotages side B, so
it needs a side B. A served checkout and these exact two commands, which are the ones
in the reproduce block below:

```bash
node night-compare.mjs --out <scratch>/break --only wc-elevated --regimes night \
  --a '' --b '' --break        --same 0.05 --refs off --local none   # -> exit 1
node night-compare.mjs --out <scratch>/brk2  --only capitol      --regimes night \
  --a '' --b '' --break slopes --same 0.05 --refs off --local none   # -> exit 1
```

> **Both of these returned exit 2, not exit 1, when an independent reader ran them on a
> loaded laptop (2026-09-20), and the sabotage had nothing to do with it.**
> `verdict.loadAsymmetry` fired on a reload-count difference alone — A 0 reloads against
> B 2 in one, A 1 against B 2 in the other — with **the same `build.sha1` on both sides,
> the same 2,600,942 authored triangles and `tilesOk: true` on every shot.** The rule was
> written for a run comparing two BUILDS, where the reload path says which build a mesh
> was built under. In a `--break` run both sides are the same build by construction, so it
> had nothing to discriminate; and side B is shot second, on a machine side A has just
> loaded twice, which makes it systematically likelier to reload. A documented watched
> failure that returns the wrong code on a busy machine teaches lanes to ignore the code.
>
> **Now:** the reload-path rule fires only when the two sides differ in `build.sha1` or in
> site. Same build, different reload paths is `verdict.loadAsymmetryWarning` — printed in
> full, not in the exit code. `tilesOk: false` and an A/B `tilesOk` disagreement are
> untouched and still exit 2; they are about the frame, not about the route to it.
> **And the converse is a verdict now too:** both sides on the same site and query and
> NOT the same `build.sha1` means a rebuild landed mid-run, which is `loadAsymmetry` and
> exit 2. That had happened once, in `build-ab-c656249-vs-main-daygolden`, and was caught
> by hand off the build printed on the overview sheet.
>
> **The residual risk, written down rather than left to be rediscovered:** the demotion is
> gated on `build.sha1` and site but **not on the query**, so the commonest real run — one
> checkout, `--a '' --b '?someflag=1'` — has the same `build.sha1` on both sides and an
> asymmetric reload there is demoted to a warning too, even though the two sides genuinely
> are two configurations. A flag that changes how the page loads would be invisible to the
> exit code. Nothing is silent about it: the warning prints in full, and `tilesOk: false` on
> any shot and an A/B `tilesOk` disagreement at the same (pose, regime) both still exit 2 —
> so a load difference that actually cost the run a layer is still caught. **Checked in the
> code, 2026-09-20:** the per-side authored-triangle count is printed and stored in the
> report, but nothing compares the two sides' counts and nothing exits on them, so it is a
> reading for a human, not a gate. If you are A/B-ing a flag that changes how the page loads,
> compare the two `sides[].apartments.triangles` yourself before trusting an exit 1.
>
> Both commands above were then run **verbatim** through `gpu-run.mjs` on a quiet machine
> against this branch: **exit 1 and exit 1**, three of three and two of two poses red — and
> again on the branch with `origin/main` merged in, which matters because that merge carries
> PR #274's new Capitol pavilions, the geometry the re-aimed Capitol rectangles sit on.
> On the merged build (`676fc22f41ab`) the Capitol run is **exit 1**, 0.181% and 0.318%, and
> the rectangles are still on their subject: `wall` **71 → 28**, `dome` **76 → 20** at
> `congress-30m`, unchanged from before the merge. The `wc-elevated` run is **exit 1**,
> 8.154 / 3.659 / 7.094%.
> Both runs happened to load symmetrically (0 reloads on both sides), so they demonstrate
> the exit code and not the gate. The gate itself was watched both ways on those same
> frames with `--from`, side B's reload count edited by hand in the report: same
> `build.sha1` → **exit 1** plus the warning; a different `build.sha1` → **exit 2** with
> both asymmetry lines.

> **Corrected in the fifth pass (2026-09-20). The two entries that used to sit in the
> list above DID NOT RUN.** `node night-compare.mjs --break --same 1` dies with
> `--out <dir> is required`, exit 2, and `node night-compare.mjs --break slopes --same 1`
> dies with `--break sabotages side B; pass --b too`, exit 2 — the argument checks at
> `night-compare.mjs:290` and `:317`, both long before a browser is launched. They also carried
> `--same 1`, which is the tolerance this same file then proves is the one that hides
> the sabotage at the Capitol. A lane copy-pasting the canonical watched failure got
> either an argument error or, after fixing it up, a documented PASS.

`--break` removes geometry, so it can only go red at a pose where that geometry is a
large share of the frame. **It came back green at the two Capitol poses with 3.56 M
authored triangles removed and the dome visibly gone** (0.172% and 0.308% of pixels
moved, against the 1% tolerance it was run with; at the derived 0.05% it is red).
Red somewhere is not red everywhere; the run's `verdict.breakCoverage` names the
poses the sabotage could not move, and the kept reports are in
`docs/night/harness-runs/`. **The whole route set at `day` and `golden` -- the
coverage map A9 needs -- has not been run**: it hung on `campus-aerial/z16-p68`
with three GPU lanes live on this laptop and was killed.

**And "the sabotage moved pixels here" is not "the instrument noticed".** That same
green Capitol run is the one that finally said what the Capitol rectangles were on,
and it had been saying it for five passes. Delete the entire authored scene -- 3.56 M
triangles, the dome visibly out of the frame -- and at both Capitol poses **every
measured number came back bit-identical**: `sky` code 3 = 3, `wall` code 8 = 8,
`ground` code 143 = 143, all three ratios, and the bright-window share. Only `dome`
moved, at one of the two poses, by three codes. The `wall` and `ground` rectangles
were on MapLibre's own fill-extrusions and road; at the Capitol we author the Capitol
and nothing else, **0.394%** and **0.430%** of the frame (pixels the sabotage changed by more than
3 of 255 on any channel; 0.172% and 0.308% at the 16-luma threshold `--same` uses).

So `pctOver` (pixels) and the acceptance table (region medians, ratios, window share)
are two different questions, and `verdict.breakCoverage` answers both now, per pose:

- `movedMeasured` / `unmovedMeasured` -- which measured numbers changed A to B, with
  each region's declared subject beside it;
- **pixels over tolerance and NOT ONE measured number moved** is `measuredNothingAt`
  -> **exit 2**. The rectangles are not on what was removed;
- a region declared `regionSubjects: "authored"` in `night-routes.json` that survives
  `--break slopes` (the mode that empties the WHOLE authored scene) is
  `authoredRegionsNotOnSubject` -> **exit 2**;
- a region with **no** declared subject that did not move is listed under
  `undeclaredAndUnmoved`. Undeclared is a third value, not a synonym for authored:
  declare it from a sabotage that measured it, never by eye off a still.

`regionSubjects` takes `authored`, `basemap` or `sky`. A ratio with a `basemap` region
on either side of the division prints with a `b` and is a true reading of the frame
that is **not** a reading of anything we build. Both new guards were watched failing on
the old Capitol rectangles before they were trusted: exit 2, both blocks populated.

**And a red `--break` is not automatically red for the right reason.** Re-run on a
busy laptop, the first of those two commands came back `FAIL --same 0.05%`, exit 1,
"5 of 5 frames" — with the UNSABOTAGED side A the broken one: unretinted tree
canopies, no lit window grid, the Capitol dome missing from the control and present
in the sabotaged side. The diff was A's defect. The only trace in the whole report
was `tilesOk: false` on all five A shots, a field that never reached the verdict.
`tilesOk: false`, and an A/B disagreement in `tilesOk` or in the recovery path
(reloads, the `APARTMENTS.on` poke), are `uninterpretable` and exit 2 now.
**If one of these comes back exit 2, read `verdict.uninterpretable` and
`verdict.loadAsymmetry` before you read anything else.** The picture and the two
reports are in `docs/night/harness-runs/README.md`.

**`--selftest` is the other half, and it was missing entirely.** `--break` only ever
watched `--same` (`pageDiff`). `pageMeasure` — the region medians, the four ratios,
the quantisation band and the bright-window share that the whole A1–A5 acceptance
table is written in — had no self-test, no synthetic frame with a known answer and no
watched failure, while the docs already record four region rectangles that were
sitting on the wrong subject and were caught only by eye. `--selftest` paints
synthetic frames whose every answer is arithmetic over a colour and a pixel count,
pushes them through the real `pageMeasure`/`pageDiff`, asserts 22 numbers exactly,
re-runs one through the JPEG path a shoot actually uses — and then sabotages the
source text of those two functions seven times, one criterion each (the Rec.709
weights, `R >= B`, `luma >= 40`, `Y >= 4 x median`, the region rectangle, the ±1-code
band, the 16-luma diff threshold) and requires every one to be caught. A sabotage
whose target string is no longer in the source is a hard failure, not a skip. It
needs no server and no `--out`, and it caught a wrong expectation in its own first
run. `node night-compare.mjs --selftest-break relk` runs one of them and prints
every assertion, so a human can watch it fail.

This repo has shipped a guard that could not fail **four separate times** (the
harness drifting from index.html, twice; a stale hand-maintained family list; a
star test that physically could not fail; a coplanar checker blind to 122,773
faces). Reviving a crasher into a permanent green would be a fifth. If you fix a
guard, watch it go red first.

## Things that will waste your time if you don't know them

- **`_harness.html` forces `preserveDrawingBuffer: true`.** That is the only way
  `gl.readPixels` returns anything but black. Pixel-sampling scripts load
  `_harness.html`; behaviour scripts load `index.html`.
- **Measure against the camera's own integrated time**, `window.__fly.simTime()`,
  never the wall clock. Headless swiftshader runs at 4–20 fps here, so
  wall-clock speed measures the renderer, not the movement system.
- **Take the MINIMUM of many timings, not the mean.** A mean on a busy machine
  measures the machine. A mean-based run once reported *day* getting 3× slower
  after a change that only touched the night path.
- **The controller owns the camera while flying.** A seeded test must wait for
  `!__fly.eye().driving` *before* placing the camera, or its `jumpTo` is
  overwritten on the next frame.
- **After `setData`, a GeoJSON source re-tiles in a worker.** Sampling 700 ms
  later returns the previous state — this made a shadow test report a bogus 43°
  error. Wait for `idle`.
- **Data-driven paint expressions and the facade atlas do not land in the same
  frame as the call.** Settle ~4 s, `triggerRepaint`, screenshot twice, trust
  the second.
- **To find which layer owns a pixel**, hide layers one at a time and diff. To
  test *where* something is, paint it magenta and take one render.
- **A mass edit across every script in here can delete a script's whole body
  and nothing will notice.** Commit `90ad9d7` (2026-07-31, "the verification
  harness must not outlive its own process") rewrote all ~80 scripts to route
  through `launch()`. In seven of them the edit swallowed `newPage`, `goto` and
  the entire `page.evaluate` and left the trailing `console.log` behind, so the
  file still parsed, still launched a browser, and then threw
  `ReferenceError: r is not defined`. They stayed that way for **sixteen days**,
  across the sky rewrite two of them existed to guard, and were found only
  because someone finally ran everything. Nothing in this repo runs the suite on
  a schedule; `inventory.mjs` is the cheapest substitute. Run it after any
  sweeping change to this directory.

## Scripts that have been deleted, and why

Kept here so nobody restores them from history thinking they were lost.

- **`silhouette.mjs`** (deleted 2026-08-16). Superseded by
  `night-silhouette.mjs`, which makes the identical claim at the identical
  threshold but samples seven columns instead of one, includes `parts-3d`/
  `parts-roof` in the roofline scan, samples the sky above the *computed*
  horizon rather than 2.5% above the roofline (the old sample was reading
  distant GROUND — luma 11 at night beside 117 at dusk for the same pixel),
  honours `VERIFY_URL`, and exits non-zero when it fails. The old one printed
  `*FAIL` and exited 0.
- **`night-debug.mjs`** and **`night-roadprobe.mjs`** (deleted 2026-08-16).
  Both are labelled "one-off" in their own headers, both were gutted by
  `90ad9d7` and had thrown ever since, and both are covered:
  `night-dusk-truth.mjs` and `tower-atlas-tone.mjs` read the same facade-atlas
  image bytes `night-debug` read, and `road-probe.mjs` prints a strictly richer
  version of `night-roadprobe`'s transportation histogram. A dead script that
  everyone steps around is debt.

## Debug hooks the suite relies on

- `window.__map` — the map instance
- `window.__fly` — `eye()`, `roofAt(lng,lat,r)`, `indexed()`, `gridBytes()`,
  `simTime()`, `consts`, `tickMsAvg` (from `js/controls.js`)
- `window.skyBodies(p)` — the shared sun/moon (from `js/sky.js`)
- `window.applyTimeOfDay(map, p, force)` — pass `force: true` to bypass the
  1/128 quantisation of the expensive path

## Graphics / post-process suite (added July 29 2026)

- `node context-restore.mjs --profile desktop|phone --out <local-scratch>`: desktop forces a map-canvas WebGL loss and restore, then checks the city pixels, a new bound renderer, the same scene, camera and light, rebuilt shadow maps, no reload and no city data fetched, plus a headless hide/show. Phone asserts its contract instead: CPU copies freed and the reload recovery kept (`slopes.canRestoreContext === false`). Hardware GL; run through the shared browser queue.

- `node graphics.mjs` — the post-process stack and its menu (27 assertions).
  Every effect is asserted by requiring pixels to CHANGE, not by checking that a
  style property was written.
- `node perf.mjs` / `perf2.mjs` / `perf3.mjs` — frame timing. **All three launch
  HEADED on purpose**: the rest of the suite uses `--use-angle=swiftshader`,
  which is right for pixel assertions and useless for timing, because software
  rasterisation moves the whole cost onto fill rate. They also must NOT load
  `_harness.html`, whose rAF shim pins the loop at ~60 Hz no matter how slow a
  frame really is.
- `node skycolour.mjs` — samples a column of sky and prints RGB + HSL. "Too deep
  blue" is a claim about pixels; read the pixels.
- `node roofz.mjs` — the roof z-fighting A/B. **Deliberately asserts nothing** —
  see the long comment at the end of the file for why a null result there is
  expected rather than reassuring.

## The z-fighting pair: `coplanar.mjs` and `zfight.mjs`

`zfight.mjs` renders and finds surfaces that FLICKER; `coplanar.mjs` reads the
data and finds surfaces that CAN. Run both — the first cannot see what is off
screen, the second cannot see across two documents.

```bash
node coplanar.mjs                      # every data/*.geojson, full report
node coplanar.mjs --gate               # red ONLY on a pair the baseline lacks
node coplanar.mjs --selftest           # eight assertions; makes itself fail
node coplanar.mjs --write-baseline     # after a deliberate fix
node coplanar.mjs data/drag.geojson    # one file
```

**Read the accounting line, not the verdict.** Every file prints
`N feats / N tops / N flat / N unreadable` before its result, because the way
this checker has actually failed is by examining fewer features than the file
holds and then reporting a clean scene:

> On the night the campus and West Campus storey trim merged (§131) it reported
> **"1144 features, no coplanar overlaps"** on a file holding **1363**. It keyed
> on `h`/`height`; the trim carries `dbase`/`dh`. Across three files **882
> extrusion rings were unchecked**, and `data/campus_storeys.geojson` was not in
> its hardcoded TARGETS list at all. That is the fourth guard in this repo found
> to pass because it could not see the thing it was guarding.

Three things now hold it shut, and it is worth knowing which one covers what:

1. **Scope comes off the directory.** A new bake's output is in scope the moment
   it lands in `data/`. There is no list to update.
2. **Anything uninterpretable is exit 2**, never a skip — unknown elevation
   signature, a non-finite `h`, or an absolute top below its own base. That last
   one is what would have caught `entrances.geojson` being read as absolute when
   `js/entrances.js` paints `['+',['get','base'],['get','h']]`.
3. **The vocabulary is audited against the stylesheet.** `auditStylesheet()`
   reads every `fill-extrusion-height`/`-base` expression in `js/*.js` and pulls
   the `['get','x']` names out with a balanced-bracket read (a line-scoped regex
   misses `js/ground.js`'s wrapped `setPaintProperty` calls). A name the app
   extrudes on with no schema stops the run.

**The seam that is still open, stated plainly.** A feature carrying an invented
property that NOTHING renders is counted as `flat` and not checked — correctly,
since an unrendered surface cannot z-fight, but it is a silent classification.
It shows up only as a jump in the `flat` column. The moment any paint expression
reads that name, guard 3 fires. So the loop is closed on the only path that can
produce a defect, and not on the path that cannot.

**`--gate` exists because the tool is permanently red without it.** The repo
carries 2,342 coplanar pairs at eps=0.01/frac=0.30, most of them never looked at
(`stadium` 313, `outer_ring` 179, `trees` 99). A guard that is always red is a
guard nobody reads, so `coplanar-baseline.json` records the per-file counts and
`--gate` reports only what grew. Changing that file in a commit is the record of
what was accepted.

**What it structurally cannot do**, and the reason QUEUE N5b had to be measured
by hand: it pairs features **within one document**. Campus storey trim lives in
`data/campus_storeys.geojson` while the buildings it rings come from the basemap
via `data/snapshots/<date>/buildings.detailed.geojson`, so a tie between them is
invisible here. There are 55 such ties. `zfight.mjs` is the instrument for that.

### `doorstack.mjs` — the third instrument, and why the pair needed a third

```bash
node doorstack.mjs shots/close/y24 poses.json 345 621
```

A coplanar pair between two `entrances.geojson` features can be one of two
completely different things, and **neither `coplanar.mjs` nor `zfight.mjs` can
tell them apart**:

* a step tread sharing a top plane with the cheek wall it sits beside — one
  door, benign, and what HANDOFF §156 judged by looking; or
* **two different buildings' front doors baked into the same doorway** — which
  looks fine in a still, because the front one hides the back one.

`doorstack.mjs` filters every `entrances-*` layer down to ONE `eid` at a time at
one fixed camera, and reports how many pixels each door group is responsible for
against an all-entrances-hidden control. **Two large arms over the same bounding
box is the doubling.** That is what turned QUEUE Y24 from an argument about a
number into a picture (`shots/close/y24/`), and it is why the coplanar baseline
was NOT moved to 1655.

Two traps it inherits and re-states in its own header: it must draw
**only-this-eid**, not all-but-that-eid (the first cut counted every door in the
viewport and returned 110,030 px over half the frame), and it must **re-pose
outward like `doorwalk.mjs`** — a 15 m standoff inside the collision net's padded
probe radius puts the camera on a roof while `__fly.eye().alt` still reads 1.70.

## Outer ring suite (added July 30 2026)

- `node outer-check.mjs` — the outer ring is what `docs/OUTER_RING.md` claims
  (20 assertions). Most of them are NEGATIVES — no AO layer, no labels, no
  facade pattern on the bulk of the ring, zero new atlas images — because those
  are the regressions that look fine in a screenshot and cost frames.
- `node outer-perf.mjs [reps]` — the A/B. Same build, same camera path, same
  settings, `?outer=0` turning the ring off at load. Headed, `index.html`.
- `node shot.mjs v2 shots-outer.json` — twelve poses along the intended flight
  paths, including three that deliberately face the new boundary.

### Two traps this suite added to the list

- **Serve on a port nobody else is using.** Three agents were serving the repo
  on 8099 from three different worktrees; every request went to whichever bound
  first, and `data/outer_ring.geojson` 404'd while sitting on disk. Use
  `VERIFY_URL=http://127.0.0.1:8123` and a matching `http.server` port.
- **Chrome throttles rAF in a window it thinks is occluded.** The first timing
  run reported a p10 of exactly 50.00 ms against 49.90 ms — 20 Hz, quantised,
  identical for both configurations, which is the window manager, not the
  scene. `outer-perf.mjs` now launches with
  `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
  --disable-background-timer-throttling
  --disable-features=CalculateNativeWinOcclusion` and calls `bringToFront()`.
  `perf.mjs`/`perf2.mjs`/`perf3.mjs` do **not** yet, so their numbers are only
  trustworthy on an otherwise idle desktop.
- **`queryRenderedFeatures` returns 0 at a flying pitch.** At pitch 77 it
  reported zero features for `buildings-3d` in a scene visibly full of
  buildings. Count `querySourceFeatures` instead, or you will spend an hour
  debugging a renderer that is working.

## Ground texture / roads suite (added July 31 2026)

See `docs/GROUND_TEXTURE.md` for what these found.

- `node ground-luma.mjs [p ...]` — the luma separation between paths, areas,
  roads and the catch-all ground, by POSITIVE identification: one render for
  colour, a second with each class painted a key colour for the mask, then the
  first render's luma averaged inside each mask. **This is the guard on the
  pale-paving trap.** If path-vs-ground ever falls back toward single digits,
  the bug that made the entire path network invisible is back.
- `node pattern-scale.mjs` — what `fill-pattern` actually does at zoom. It is
  anchored in TILE space at the image's native pixel size and resets at every
  integer zoom, so a tile's size in METRES halves each level (32 px measured
  33.0 m at z16, 16.5 m at z17, 8.2 m at z18). Only scale-free noise survives.
- `node ground-flatness.mjs [p]` — "reads as paper" as a number: the share of
  16×16 blocks whose luma sd is near zero, plus a distinct-colour count, with
  each technique isolated so neither gets credit for the other's result.
- `node tex-inspect.mjs <prefix> <shots.json>` — one surface with the pattern
  on, off and alone, plus the raw tiles at 3×, in a single browser session.
- `node ground-tex-perf.mjs [reps]` — the A/B for the roads and the textures.
- `node road-probe.mjs` — what the basemap carries under `transportation`.
- `node settings-probe.mjs` — drives the `GROUND` flags and asserts on PIXELS.

### Three more traps

- **Do not hand a full framebuffer back through `page.evaluate`.** Returning
  `Array.from(buf)` for a 1280×800 canvas is 4M numbers through CDP; it ran for
  twenty minutes at 2 GB of RSS before it was killed. Do the reduction in the
  page and return the aggregate. `ground-luma.mjs` keeps the luma plane in a
  `window` global between the two passes for exactly this reason.
- **Node's `console.log` does not understand `%8d`.** It leaves the specifier as
  literal text and then shifts every later argument into the wrong slot. One
  A/B table printed a config echo claiming the roads layer was hidden in the
  configuration that had just switched it on. Use `padStart`, not printf.
- **Interleaving is not enough on its own — counterbalance the order.** The
  machine drifts upward across a run (183 dropped frames in the first rep, 193
  in the fourth), so whichever configuration always runs first in the rep gets
  the coolest slot and wins by construction. `ground-tex-perf.mjs` reverses the
  order on alternate reps.

### And one bug this suite caught that reasoning did not

`GROUND.roads = false` then `true` left the roads switched off. Our road layers
read from the basemap's own `transportation` source-layer, so the routine that
hides "every visible transportation line" matched them too and hid them again on
the same call that had just shown them. The style flags and the pixels agreed —
27.8% of the pose was our asphalt with roads on, 3.2% with them off, and 3.2%
again after turning them back on. Reading the flag alone would have found it;
reading the flag in the same JS turn as the write would NOT have, because the
table then lags a full step and reads as a reporting artifact.

### Timing traps, learned the hard way

- **A median frame time is not a performance measurement.** It sits on the
  16.7 ms vsync floor even while half the frames are being dropped, and every
  subsystem delta then reads as exactly 0.0 ms. Count dropped frames.
- **Never trust a single run.** Four sequential runs of the *same*
  configuration produced 23.4 / 32.4 / 43.6 / 40.9 fps — a 2× spread of pure
  noise that would have read as a clean ranking. Interleave configurations
  (a,b,c,a,b,c…), repeat, report the median with its spread, and if the spreads
  overlap there is no result.
- **Hold nothing down.** Flying with `W` makes every run cover different
  buildings; that was a bigger noise source than any setting being compared.
  Script a fixed bearing sweep so every run renders identical content.
- **`page.addInitScript(fn)` runs `fn` in the PAGE**, so a closure over a config
  object is not available there — pass it as the second argument. Getting this
  wrong installed nothing, and four "different" configurations all silently ran
  identically while the report printed four different numbers. Always echo the
  thing you think you set (`gl.getContextAttributes()`) next to the result.
- **`transform.horizonLineFromTop()` returned 0 at every pitch**, which
  collapsed a sky sampling column onto row 0 — five identical readings that
  looked like a flat sky. Use the closed form: `0.5 - 0.5·tan(90−pitch)/tan(fov/2)`.
- **Cancel the graphics auto-detect probe** at the top of any test or shot list
  (`window.cancelGraphicsAutoDetect()`). It fires 11 s after load and rewrites
  every setting; left running it lands mid-test and reads as the render-scale
  lever being broken.

## A cold server will hand you a phantom bug

Symptom: a large GeoJSON layer — the stadium is the worst offender at ~300 KB
and 523 features — is simply ABSENT from the frame, leaving a flat hole at its
own footprint while the city around it looks completely normal. It renders fine
from other poses, which makes it look like a view-dependent rendering defect.

It is not. `shot.mjs` waits a fixed time after `jumpTo`, and that is not enough
to fetch, tile and paint a large source when the HTTP server has just started
and nothing is in the browser or OS cache. `isolate.mjs` waits on the map's own
`idle` event instead, which is why it will happily draw the same layer at the
same pose and appear to contradict the screenshot.

The same trap, one layer up (2026-10-09). MapLibre's `idle` does not see the
app's own paced work: walls are stamped in jobs after the camera stops
(`__facadePace.busy`) and the authored apartment buildings are built in chunks
(`slopesApartments.count.done`). A shot before they finish shows one building
in its plain stand-in, in one shoot only. In CI that reads as a changed patch
on a building the pull request cannot touch. `shot.mjs` now waits until both
are quiet for three reads in a row (60 s at most a view). On the CI software
renderer the wall job never finishes at all, so the picture runs also load the
page with `facadepace=0&timeofdaypace=0` (`LOOK.shotQuery` in `ci/pictures.mjs`):
walls are then painted at once, and every shoot sees the same finished city. If a flag still lands on a building the
change cannot touch, run again before merging, and look for the next thing
`idle` cannot see.

This cost three wrong diagnoses in one session — "the camera is aimed wrong",
then "the layer is being occluded", then "it is a real defect at this pose".
The discriminator is cheap: **run the same pose twice.** If the second run shows
it, the server was cold. `whoccludes.mjs` (does any layer above it cover this
pixel?) and `dkrdiag.mjs` (is the source tiled and are the layers visible?) are
in this directory to settle the other two hypotheses without guessing.

Note that `queryRenderedFeatures` is useless for this check — it returns 0 for
fill-extrusion layers even at poses that demonstrably render.

## THE APP MOVES ITSELF AFTER 25 SECONDS — always pass `?drift=0`

`js/app.js`'s **idle cinema** turns an unattended screen into a screensaver of
the city. After `DRIFT.idleMs = 25 s` of input silence it starts, and every
`stepMs = 12 s` leg it:

- eases the **bearing** by `bearingStep = 13°`,
- breathes the **zoom** by `zoomBreathe = 0.05`,
- and creeps the **hour** by `pStep = 0.010`.

A scripted run sends no pointer or key events, so **the countdown never
re-arms**. Any script that places a camera and then works for more than 25 s is
being moved under its own feet — pose, zoom and time of day.

This is not a bug and it is not new. It is a shipped feature with a shipped
opt-out, and `js/app.js` says so in its own comment: *"?drift=0 disables it for
scripted runs against index.html."* `drift-check.mjs` is the guard on it.

**What it cost, measured.** On 2026-08-16, 91 of 129 page-loading scripts passed
`drift=0` and **38 did not** — including `sky.mjs`, `dusk.mjs`, `banding.mjs`,
`night-silhouette.mjs`, `graphics.mjs`, `movement.mjs`, `collision.mjs` and every
`light-*`. `sky.mjs` was consequently reporting **10/12, with `setLight` said to
disagree with the shared sun by up to 4.82°**, on the sky rewritten hours
earlier. It was the ruler. `sunlight-probe.mjs` traced `setLight` being called
twice for one request — az 118.8 then 120.88, `__todCurrentP` left at 0.11 for a
requested 0.1, i.e. exactly `pStep` — and with the drift off the same file is
**12/12**.

Three things follow, and the third is the one that bites:

1. `suite-lint.mjs` rule 8 now blocks any script that loads a page without it.
2. **A clean run with the drift ON proves nothing.** Whether a 12-second leg
   lands between a write and a read is a race: the same build gave 4.82°, 1.20°
   and a clean 12/12 across three runs. Intermittent reds are why this one
   survived so long.
3. It compounds with every "settle and screenshot" wait in this directory.
   `shot.mjs` settles 4 s per pose and a 12-pose list is well past 25 s, so a
   shot list without `drift=0` can photograph a bearing nobody asked for.

## A gate that prints FAIL and exits 0 is decoration

`sky.mjs`, `collision.mjs` and `night-sky.mjs` each printed `*FAIL` and then
exited 0 — so `inventory.mjs`, `run.mjs` and anything else that reads an exit
code saw success. §149 deleted `silhouette.mjs` partly for this and added no
check; `suite-lint.mjs` rule 7 is that check. Exit codes are load-bearing
(§142): **0 pass, 1 an assertion failed, 2 cannot run, 124 the watchdog.**

`sky.mjs --break` biases the `setLight` azimuth +7° in the page and must come
back red with exit 1. Use it before trusting a green.

## Two more traps from the same night

- **`chrome.mjs`'s watchdog used to be unraisable from the script.** It read
  `VERIFY_MAX_MS` into a module-level `const`, and ESM hoists imports, so a
  script could not set its own ceiling before the value was frozen. `walk.mjs`
  needs ~12 minutes and was therefore **unrunnable the way this README documents
  it**: it printed PASS on all three sites and was then SIGKILLed at 300 s for
  exit 124. It is read at `launch()` time now, and callers may pass `maxMs`;
  `walk.mjs` and `walk-trunk.mjs` derive theirs from the constants that set the
  walk length.
- **`shot.mjs` cannot resolve a time-of-day change finer than 1/128.** It calls
  `applyTimeOfDay(m, s.p)` with no force flag, so every `p` in every shots file
  is rounded to the nearest 0.0078 before it is drawn. That is faithful to the
  app — and it means the two poses either side of QUEUE Y20 (0.590 and 0.595)
  render as the *same frame*. `y20-frames.mjs` photographs that transition on
  the grid the app actually uses.

## The walking suite — and the reason nothing here could walk until 2026-08-16

`lib/walker.mjs`, `walk.mjs`, `walk-lift.mjs`, `walk-trunk.mjs`.

**The symptom, as three separate passes recorded it.** Every scripted walk
travelled its target distance and **ended at 23.8 m, the same digit every rep**.
Above `TRUNK_ALT` (12 m) the trunk field switches off, so QUEUE Y15 was written
"could not be measured" three times (HANDOFF §132, §133, QUEUE Y15/Y16). A
constant that precise was read as a silent lift inside `js/controls.js`.

**The cause, traced frame by frame by `walk-lift.mjs`.** The app was innocent:

```
frame 0   alt  1.70   roofAt(eye, 1 m) = 8.6    roofAt(eye, 6 m) = 19.8
frame 1   alt 12.60   = 8.6 + HARD_CLEAR(4)     <- hard net, 0 m travelled
frame 3   alt 23.80   = 19.8 + HARD_CLEAR(4)    <- hard net again
```

**The walk phase started inside a building.** The hard net (`controls.js:1617`)
ejected the camera on the first tick, at zero metres, and it fired TWICE because
the ejection is a positive-feedback ladder: `rCam()` lerps 1.0 → 6.0 m as
`groundMix()` falls to zero, so the moment the first ejection carries the eye
past `ALT_GROUND` the probe radius sextuples, sees a taller roof, and the net
fires again. **23.8 m is `roofAt(that hard-coded start, 6 m) + HARD_CLEAR`**, and
it repeated to the digit because the start pose was hard-coded and deterministic.
Nothing was resolving altitude to a constant.

### The two rules that make a scripted walk a walk

1. **Start on open ground.** `walker.findStart()` searches outward for a point
   where `roofAt(p, 7 m) === 0` and no trunk claims the cell, and returns `null`
   rather than a compromised start. 7, not `R_CAM`'s 6: the collision grid is
   quantised to `CELL = 6 m`, so a probe at exactly 6 can be one cell short of
   what the net will see once the ladder starts. §105 already said to stand where
   `roofAt(p, 3 m) == 0`; nothing enforced it, and the enforcement is the fix.
2. **Steer.** A fixed bearing walks into the first building on that heading —
   §132 measured 3 m and 11 m at two of its six sites. The walker probes the roof
   and trunk fields along a fan of candidate headings and turns toward the
   clearest, applying the turn through the LOOK INPUT (`pointermove`), never by
   writing `bearing`. Only keyboard and pointer events are sent; no app code is
   patched and `js/controls.js` arbitrates exactly as it does for a person.

### Judge the SERIES, never the endpoint

`walk()` reads `__fly.eye().alt` on **every frame** and returns the whole series;
`stayedDown` is true only if no frame reached the ceiling. This is not
belt-and-braces. §132's 23.8 m was an endpoint that hid a walk which never
happened, and §105 has the mirror-image case — a summary table that read as a
ladder and was one correct ejection on frame one. **An endpoint cannot tell a
walk from a flight, and a maximum cannot tell one bad frame from ninety.**

### Two more traps this suite added

- **Displacement is not distance walked.** A steered walk that turns a corner has
  a displacement well under its path length, and the rescan triggers this suite
  cares about (`TRUNK_RESCAN_M`, `OUTER_RESCAN_M`) fire on movement. The walker
  reports both and stops on PATH. Reporting displacement alone under-reports a
  real walk exactly as badly as the endpoint over-reported the old one.
- **`sprintHeld = e.shiftKey`** (`controls.js:1326`) reads a modifier flag, not a
  key: a separate `ShiftLeft` keydown does nothing AND the `KeyW` that follows
  clears the flag. The shift bit has to ride on the same event. At walking height
  `SPEED_MIN` is 1.0 m/s, so getting this wrong halves every walk.

```bash
node walk-lift.mjs [site ...]   # WHY a walk leaves the ground: per-frame trace + attribution
node walk.mjs [reps] [--quiet]  # the gate: 3 sites walk, every frame under 12 m,
                                # plus a WATCHED FAILURE that must come back lifted
node walk-trunk.mjs [reps]      # QUEUE Y15 from a real walk, walk vs hop, interleaved
```

## The slopes layer gate (added September 2 2026)

`js/slopes.js` is the one layer in the app that is not MapLibre's own — a
three.js `custom` / `renderingMode: '3d'` layer that carries the real pitched
roofs (`js/slopes-roofs.js`, off the `rig` member of roofs.geojson), the
arches (`js/slopes-arches.js`, off the `arches` member of entrances.geojson)
and the Capitol dome (`js/slopes-dome.js`, lathed from capitol_dome.geojson).
`slopes-layer.mjs` proves, from pixels on the real page, that a mesh in it is
treated exactly like the fill-extrusion beside it, that the generators draw
a slope where the slabs drew stairs and a curve where the chords drew five
flats, and that switched off it leaves a frame identical to the one it was
never in.

```bash
VERIFY_URL=http://127.0.0.1:8442 node slopes-layer.mjs                 # the gate
VERIFY_URL=http://127.0.0.1:8442 node slopes-layer.mjs --break         # 9 lines must go red
VERIFY_URL=http://127.0.0.1:8442 node slopes-layer.mjs --shots DIR --against http://127.0.0.1:8443
```

**Read this before you trust or edit a line of it. On September 2 2026 the gate
ran 32/38 against a layer that was RIGHT** — six reds, and not one of them was
a defect in the app. Four of the six were assertions that had gone stale under
the generators they were written before; one was a regex that could not match a
correct filter; one was a premise that was simply false. The repair is in the
list below and the lesson is the older one in this file: a guard that cannot
fail and a guard that cannot pass are the same bug. It is **48/48** now, on
hardware GL against `git archive main` on a second port, and the things that
changed are:

- **The roofs filter regex.** `roofs-pitched`'s filter serialises as
  `["match",["get","f"],[...],true,false]` — a `match` whose input is the
  `["get","f"]` EXPRESSION. The gate asked for `/"match","\["get","f"\]/`,
  with the comma inside the quotes, which no correct filter can produce. It is
  `ROOFS_FILTER_RE` at the top of the file now, anchored, so the next person
  reading a red line can see what shape was expected.
- **`root.children === 0` is gone.** "The layer is installed, drawing an empty
  scene" was written the day the layer landed and was stale the moment the
  generators did. The line now names the three groups it expects —
  `slopes-roofs`, `slopes-arches`, `slopes-dome` — and asserts the scene is
  those and nothing else.
- **The arch is measured as a SHAPE, not as a tone.** The old line asked that
  the six pixels on the surround's curve be one tone lighter than the fanlight.
  At `battle-door` the mesh reads `136 103 87 136 136 136` and the chords read
  *exactly the same*, so it went red on a correct arch and would have gone
  green on a wrong one. What separates a curve from its stand-in is WHERE the
  surround is: the stand-in is not a five-sided polygon, it is a STAIRCASE
  (`bake_entrances.py`'s `ARCH_TIERS = 5`, each chord freezing its half width
  at its own tier's mid height). So the gate walks the head with
  `ARCH_SAMPLES` raycasts and asserts every one lands on the arches mesh
  within `ARCH_ON_ELLIPSE_M` of the exact ellipse — printing, from the same
  samples, how far the five chords are from it, and requiring the mesh be
  `ARCH_CHORD_RATIO` times closer. A staircase cannot pass that, so no
  separate "no plateau" test is needed on top of it. A second line samples
  `ARCH_PROBES` pixels chosen where the curve is surround and the chords are
  NOT, and asserts they move when the chords come back.
- **The switch section asks about OFF, not about ON.** With the generators
  drawing, the ON frame is *supposed* to differ from the slabs — the old lines
  compared them and were stale from the day the roofs landed. The promise is:
  `SLOPES.on` false then true again is the frame it started from at 0 px;
  every filter the layer touched comes back BYTE-IDENTICAL to a `?slopes=0`
  page's (compared against a real one, not merely checked for `null`);
  `?slopes=0` equals a `git archive main` on `--against` at 0 px. Two
  supporting lines keep those zeros honest — the harness's own noise floor
  (one settled page shot twice) and a live count proving the layer really
  draws at that pose, so nothing here can pass by drawing nothing.
- **One line in that section is NOT a zero, and it is a ratchet with the
  ceiling named.** The switched-off frame against a `?slopes=0` LOAD is
  **6,134 px of 1,296,000 (0.47 %)**, reproducible to ±1 across nine
  independent pairs. Measured on September 2 2026, hardware GL:

  | comparison | pixels |
  |---|---|
  | plain `?slopes=0` load vs plain `?slopes=0` load (3 pairs) | 0 |
  | ON → OFF → ON, same page | 0 |
  | OFF with the layer's `render()` STOPPED vs running | 0 |
  | OFF vs a `?slopes=0` LOAD (9 pairs) | 6,134, maxΔ 78 |
  | ...with `slopes-mesh` REMOVED from the style | 969, maxΔ 12 |

  So the mesh puts **nothing** on the screen when the switch is off — the gate
  asserts that control explicitly, by setting the custom layer's layout
  visibility to `none` so MapLibre stops calling `render()` at all, and
  requiring 0 px. 5,178 px of the residue is the mere PRESENCE of one more
  layer in the style: MapLibre slices the depth range per layer, so a
  224-layer style gives every layer a thinner slice than a 223-layer one and
  the depth ties between coplanar roof steps land the other way. It is almost
  all Δ1-8, 39 pixels above Δ20, isolated, no clusters, densest where distant
  geometry is. It is **not** `opaquePassCutoff` (84 in every state) and it is
  **not** a filter round-trip (0 px on a `?slopes=0` page put through the
  identical round-trip). The last **969 px, which survive removing the layer,
  are not explained** — something else `js/slopes.js`'s boot leaves behind, and
  the next person to touch that file should find it.
- **AUTO-EXPOSURE IS PINNED OFF ON EVERY PAGE THE GATE OPENS, and without it
  none of the numbers above mean anything.** `js/graphics.js`'s meter is open loop and runs from
  `updateSky`, which fires on map `move`, `resize` and hour changes — never per
  frame — and its 40x24 `drawImage` reads the PREVIOUS frame's buffer. So the
  first `jumpTo` after a load meters the LOAD pose, and any two pages compared
  across a `jumpTo` are being compared on their METER HISTORIES rather than on
  their renders. That, and not this layer, was the 163,822-pixel Δ1 "far field"
  difference and the 3.8% brightening the runtime toggle appeared to cause on
  September 2 2026 — both reproduce on a `?slopes=0` page with no layer
  present. `aeMeter` resets its gain to 1 the next time it runs with the flag
  off, which the pose's `jumpTo` guarantees, and the gate asserts `__ae().gain
  === 1` on every page it diffs. `gl.readPixels` never saw the gain anyway
  (the grade is a CSS filter on `#map`), so the SAMPLED colours are untouched
  — only the screenshots move, and pinning it took the cross-load difference
  from 176,269 px beyond Δ2 down to 0 for two plain loads.
  **Any cross-page screenshot comparison in this suite needs the same pin.**

- **It runs on the real GPU by default** (`VERIFY_GL=swiftshader` to override),
  which the rest of the pixel suite does not. That is allowed here because
  every assertion is RELATIVE — a mesh cube against a fill-extrusion twin in
  the same frame, the layer on against off — never an absolute hex.
- **`?slopesdebug=1` is the fixture.** The gate does not build geometry; it
  measures the debug scene js/slopes.js ships behind that flag (a parity cube
  and its extrusion twin on the South Mall lawn, slabs behind and in front of
  the Tower, a post pair 2.5 km out for the fog, a lathe for the preset).
- **`--against URL`** compares the `?slopes=0` frame with the same pose served
  from a second checkout — how "off is pixel-identical to today" was proved
  against a `git archive` of `main` rather than against the branch itself.
- **`lib/png.mjs`** is the differ it uses: a dependency-free decoder for
  exactly what Playwright writes (8-bit RGBA, non-interlaced), reporting the
  count of differing pixels, the max channel difference and a bounding box.
  A count and a box, because "0 pixels differ" and "26,621 pixels differ, all
  inside the slab" are different sentences and a hash can only say the first.
- **Section 1b is the generators.** On the same page, after the debug
  scene: the three groups exist and the three filters are in place (and are
  put back, exactly, by `SLOPES.on = false`); at the gregory pose the hipped
  roof whose two long slopes the current light separates best reads as two
  tones either side of its ridge, one tone along each slope, and a raycast
  down the slope climbs continuously at the rig's pitch (a staircase would
  plateau); at the battle-street pose the nearest arched door's head is walked
  with 33 raycasts against its ellipse and against the five chords, six pixels
  are sampled where the curve is surround and the chords are not, and the head
  as a whole is diffed against the chord frame. The same door is measured
  again from 22 m (`battle-door`) where the curve is ~100 px across and the
  difference is the picture. Frames land in `--shots DIR` as
  `ridge-gregory.png`, `arch-battle-street.png`, `arch-battle-door.png`.
- **The LOD assertions changed on September 2 2026 and the old ones were
  wrong.** `js/lod.js` hides a custom layer by calling
  `implementation.setVisible(false)` and NOTHING ELSE — it must never write
  `visibility` on one. MapLibre 5.24 honours that property on a custom layer by
  never calling its `render()` again, and `render()` is where js/slopes.js
  gives the tier's verdict PER GROUP; hidden wholesale, the Capitol dome went
  with the roofs while the layer's own filter still held its fill-extrusion
  discs down, so there was no dome at all. Assert, at altitude:
  `getLayoutProperty('slopes-mesh','visibility') === 'visible'` (not `'none'`),
  `LOD_isHidden('slopes-mesh') === true`, `slopes.layer.isVisible() === false`,
  `slopes.frames` still climbing over a repaint, and
  `slopes.stats().groups` reading `slopes-roofs: false` with
  `slopes-dome: true`. And the other half of that defect, which is the half
  that made it invisible rather than merely wrong: while the layer is held
  down, `capitol-dome`'s filter must STILL be excluding the stacked discs,
  because the dome group is still drawing. Both shapes gone at once is how the
  skyline went empty, so the gate asserts the filter at altitude too.
- **`--break` sabotages the page in two ways and NINE lines must go red.** The
  layer is moved to the END of the style, above the fog (`stack` and both
  `haze` lines — 3), and `SLOPES_ARCHES.on = false` puts the five chords back
  in place of the mesh (all three `arch` lines at both poses — 6). Nothing on
  disk changes. The second sabotage is there because the arch assertions are
  the ones most easily written so that they cannot tell the two shapes apart —
  the ones this gate already got wrong once. Measured September 2 2026:
  **38/47** with `--break` (no `--against`) against **48/48** without.
- **Budget: ~18 minutes** — four full page loads (five with `--against`) and
  twelve poses. Run it in the background if your shell has a shorter ceiling;
  the watchdog is 1500 s.

### Two things this gate found on its first day, both about the matrix

- Of the matrices MapLibre 5.24 hands a custom layer, only
  `defaultProjectionData.mainMatrix` takes MercatorCoordinate units.
  `modelViewProjectionMatrix` fed those units collapses every vertex onto one
  sub-pixel point — the layer "renders" every frame and draws nothing, and
  nothing says so. The first cut of the layer shipped that way for an hour;
  the fill-extrusion twin in the debug scene is what made it visible.
- MapLibre's mercator matrix already carries a reflection, so the local
  east/north/up frame's mirror goes in the CAMERA matrix. Put it on a three.js
  Group instead and three flips the winding for that group's negative
  determinant, which uncancels it: every front face is culled and the sampled
  wall reads exactly the formula's UNLIT value. A pixel proved that in a way
  no amount of handedness reasoning had.

## Campus roof and pavement repairs

`python scripts/verify/campus-repairs-data.py` checks campus and West Campus
walking surfaces, scored paving and raised curbs against the actual rendered
asphalt. `--before` must fail on the original overlap. `campus-repairs-check.mjs`
checks the real roof predicate, loaded equipment tiers, retired facade overlays,
nearby routes and night/preset behaviour. Its `--break` mode substitutes the
unsupported polygon-within predicate and must fail.

`VERIFY_OUT=<scratch> node scripts/verify/campus-repairs-visuals.mjs` captures
matched views; use `CAMPUS_STAGE=before` for the frozen baseline, `CAMPUS_ONLY`
for a comma-separated subset and `CAMPUS_TIME=1` for night. The script cancels
auto-detection and retains the second screenshot.

Ground-only repairs can run with `python scripts/bake_ground.py --resolve-pavement`.
A full ground regeneration runs that stage automatically. The road recipe no
longer writes a second file as a side effect; run `python scripts/bake_roads.py`
separately when road markings/tiles need rebuilding.

## The night comparison harness: `night-compare.mjs` + `night-routes.json` (added September 19 2026)

The instrument for the night renderer (`docs/night-implementation-plan.md`, W0 and
§7). It is a **comparison** harness, not a gate: it shoots the same named poses
at the same lighting regimes for one build, or for two builds or flag sets side
by side, and writes labelled sheets plus a JSON report of measurements.

`night-routes.json` holds 16 poses on 11 routes (plan §7.1): the downtown skyline
from the south shore, Congress Avenue at 1.7 m, three generic elevated West Campus
views that frame what the owner photographed (IMG_9964-9969), two West Campus
streets at eye level, the Main Mall and Tower, the South Mall, the Guadalupe
storefronts, the Capitol (30 m and down the avenue at 1.7 m), State Parking Garage
R, Lady Bird Lake (aerial and from the Lamar bridge) and the campus aerial. A pose
is `eye`/`target` (`[lng, lat, metres]`) or a plain `center/zoom/pitch/bearing`.
The regimes are slider values, and `defaultRegimes` is all four of the plan's
acceptance elevations: `blue` p .62 (sun −5.8°), `twilight` .69 (−12.1°),
**`early` .7222 (−15°, the owner's 20:36 series)** and `night` 1.0 (−40°), plus
`day` .30 / `golden` .50 for the no-regression check (A9). `early` was missing from
`defaultRegimes` until September 20 2026, which meant the only regime the owner's
own photographs measure was named in the plan, titled into a route and never shot.
If you shorten a run with `--regimes`, keep `early` in it.

Each pose carries named `regions` — `sky`, `wall`, `ground`, `water` feed the
ratios; any other name (`dome`, `tower`) is measured and reported but not divided.
**A region under 1% of the frame is flagged** (`small` on the region, `#` on the
ratio in the table and on the sheet): a median over four thousand pixels of a
gradient sky is a number, not a measurement of the sky.

**A ratio whose denominator is near black is flagged too** (`dark` on the region,
`~` on the ratio), and a band is printed beside it: the same ratio recomputed with
that denominator one 8-bit sRGB code darker and one lighter. **At p = 1 the `sky`
median is code 3 or 4 out of 255 in fourteen of the sixteen poses**, so a deep-night
`wall/sky` is a quotient of two near-black codes and moves 25–50% on one code. That
is why `wall/sky 4.98` came back bit-identical from three different renders at two
different viewport sizes on September 20 2026 — the medians simply landed on the
same code, not because the scene was the same. Read the band, never the number:
`lady-bird-lake/aerial-west-120m` prints **10.7** at p 1 and its band is **8.0–16.0**,
which straddles the plan's A3 target of ≥ 15. A ratio is the wrong question at deep
night; the frames are fine, the division is not.

Each route takes optional `refs` per regime (paths under `../austin-reference-images`,
local, never committed). **Bind a reference to the regime its own PIXELS are, and
write down why in its `refNote`.** Four of the first sixteen bindings had drifted —
a blue-hour skyline on a twilight row, two blue-hour property photos on twilight
rows, and a full-night photo on a twilight row where it was also the same picture as
the night row at lower resolution — so three sheets showed the wrong hour and one
showed the same photograph twice. An empty cell is a fact about the corpus. And **do
not bind a no-derivatives file at all**: `--refs on` composites the reference into a
sheet, which is a derivative. See the `_readme` and the `refNote` fields in
`night-routes.json`.

> **Superseded 2026-09-20, and this paragraph went on saying the old rule for two
> more passes on the same day.**
> It used to read "bind a reference to the regime its own package entry is tagged
> with". A package entry's regime is *a word somebody typed*; a row is *a sun
> elevation*; agreeing with yourself is not a check. `night-refmeasure.py --sun`
> computes the elevation from each photograph's own stated clock, and on 46
> photographs it found eleven where the word and the clock disagree and one bound to
> a row 29° away from its own clock. The rule is therefore: **the pixels decide, the
> clock checks, and the `refNote` records the argument.** `hargup` is the worked
> example — its `sources.json` says "full night", its clock says −10.8°, its sky is
> not black, and it is deliberately bound to `twilight` with the reason written
> down. A binding that disagrees with its own tag is fine. A binding nobody
> explained is not.

**Pitch cannot go above the horizon**, so a target above the eye clamps to 88°,
and the map centre then lands about 28.6 × the eye height ahead: the subject sits
high in the frame, not at its centre. Stand back far enough that it still fits.

**A camera that reached its pose can still be facing a wall.** Two of the first
sixteen were: the Capitol gate pose stood 41 m east of the Congress Ave centreline,
inside the buildings, and a West Campus garage guess landed on an apartment facade.
Both reported `camera ok` at every regime. Always look at `overview-A-*.jpg` before
quoting a pose.

**`--break` was green, and that is the most important thing this harness has
learned about itself.** The flag exists so that `--same` -- the only assertion in
the tool, and the whole of the A9 no-regression row -- can be shown to fail. It had
never been run. Run for the first time on 2026-09-20 it came back `PASS --same 1%`,
exit 0, with A and B differing on **0.005%** of pixels and every measured number
identical on both sides. It had hidden the authored apartments with
`group.visible = false`, and `js/slopes.js` `render()` rewrites `g.visible` for every
child of `root` **on every frame** from minzoom and the LOD tier (`js/slopes.js:1030-1036`)
-- so the flag was back to true before the first screenshot. `--break` now calls
`slopes.remove(group)`, which that loop cannot undo, and the run **dies** if the
group is back in the scene at the first repaint or at the end of the shoot. Both
halves are now demonstrated on `wc-elevated/over-drag-wnw` at `night`: control
**0.006%** (exit 0), sabotaged **8.162%** (exit 1), bright windows 13.349% -> 1.852%.
**An assertion nobody has watched fail is not an assertion.** Both reports are kept in
`docs/night/harness-runs/`, because a demonstration that lives in a swept scratch
folder is the same claim on trust it replaced.

**...and the floor is zero, so `--same 1` was never the right number.** `--break`
removes geometry, so it can only go red where that geometry is a large share of the
frame -- at the two Capitol poses, `--break slopes` took **3,560,273 triangles** out
(the dome visibly gone) and moved **0.172%** and **0.308%** of pixels: `PASS --same
1%`. The fix was not a stronger sabotage. Measured 2026-09-20, `main` against itself,
two independent page loads, 16 poses x `day` and `golden` on a quiet machine: **0.000%
on all 32 frames**, 24 of them byte-identical JPEGs, worst mean |delta luma| 0.021.
The renderer is deterministic across loads at those regimes, so the A9 tolerance is
**`--same 0.05`** -- ten times the largest reading ever taken from an unchanged build
(0.005% at `night`, on a loaded machine). Re-measured at 0.05 with `--from`, no app
loaded and nothing re-shot, the Capitol wipe goes red: `FAIL --same 0.05%`, exit 1,
both frames named. **A tolerance nobody derived is a tolerance that hides whatever
fits under it.**

**`count.buildings` is not a count.** It is incremented inside the time-sliced build
and zeroed at the top of it, but the `APARTMENTS.on` poke can start a second build
that overlaps the first and counts on top of it. Measured on one build at one port:
196 (clean), 298, 323, 363 -- with `triangles` bit-identical at 2,600,942 throughout
and the catalogue holding exactly 196. **Quote `triangles`.** The harness now logs it
first and warns when the raw counter exceeds `catalog`.

**`--from` rewrites the sheets, so it records its own settings.** It used to
overwrite only `remeasured` and `routesFile`, leaving `args`, `when`, `gl`,
`viewport`, `localOverlay` and `harnessGit` describing the original shoot -- which
once left `args: ... --refs off` sitting in a folder whose sheets had fifteen
third-party photographs composited into them. The shoot's settings now keep the
top-level names and also appear under `shoot`; the measuring pass writes `remeasure`
(its own args, git, routes file, local overlay, `refs` and tile width) and
`referenceSheets` (every photograph it composited, and `mayBeCommitted`). When it
composites any, it also drops a `DO-NOT-COMMIT.txt` in the folder.

**Matched poses for the owner's photographs are private.** They reveal where he
took them. They live in `../austin-reference-images/_night/night-routes.local.json`
(outside every repo), which the harness loads automatically and announces in
capitals; `--local none` skips it. Never copy a pose from it into a tracked file,
and never commit a sheet made with it.

**On the Acer every run goes through the lanes' GPU-slot wrapper** (parallel
hardware-GL Chromes have blue-screened it):

```bash
python scripts/serve.py 8661                       # from the repo root
VERIFY_URL=http://127.0.0.1:8661 node <lanes>/gpu-run.mjs --label night-compare -- \
  node scripts/verify/night-compare.mjs --out <scratch>/run1

# a flag against the build as shipped
... night-compare.mjs --out <scratch>/flag --a '' --b '&someflag=1'
# two builds (main on :8661, a branch worktree on :8662)
... night-compare.mjs --out <scratch>/ab --a-site http://127.0.0.1:8661 --b-site http://127.0.0.1:8662
# day and golden must not move (A9): exit 1 if any frame differs in >= 0.05% of pixels.
# 0.05 is MEASURED, not chosen: main against itself over 16 poses x day and golden is
# 0.000% on all 32 frames, 24 of them byte-identical JPEGs. See "the floor is zero" below.
... night-compare.mjs --out <scratch>/a9 --regimes day,golden --b-site http://127.0.0.1:8662 --same 0.05
# the watched failure: side B has the authored apartments taken OUT OF THE SCENE in the page.
# This must exit 1. It exited 0 until 2026-09-20 -- see "--break was green" below.
# An exit 2 here is the MACHINE, not the sabotage: read verdict.uninterpretable first.
... night-compare.mjs --out <scratch>/break --only wc-elevated --regimes night --a '' --b '' --break        --same 0.05 --refs off --local none
# the stronger sabotage, for a pose the apartments are not in: the WHOLE authored scene
... night-compare.mjs --out <scratch>/brk2  --only capitol      --regimes night --a '' --b '' --break slopes --same 0.05 --refs off --local none
# the MEASURING half, watched failing. No server, no --out and no app -- but it DOES launch
# a Chrome (SwiftShader) to run the real pageMeasure/pageDiff, so on the Acer it takes a GPU
# slot like everything else. It must exit 0. (This line used to say "no GPU" and run bare.)
node <lanes>/gpu-run.mjs --label night-selftest -- node scripts/verify/night-compare.mjs --selftest
node <lanes>/gpu-run.mjs --label night-selftest -- node scripts/verify/night-compare.mjs --selftest-break relk
# fold another run's frames into this one's report, with its provenance
... night-compare.mjs --out <scratch>/run1 --from <scratch>/run1 --merge <scratch>/run2 --refs off
# change regions, then re-measure an old run without loading the app
... night-compare.mjs --out <scratch>/run1 --from <scratch>/run1 --show-regions
# R10, the phone pass (the regions were read off landscape frames: re-read them first)
... night-compare.mjs --out <scratch>/r10 --viewport 393x852 --a 'lite=1'       --only wc-elevated,wc-street --show-regions
# ...and the leg that separates the PRESET from the ASPECT (see below): lite at landscape
... night-compare.mjs --out <scratch>/lite --a 'lite=1'                         --only wc-elevated,wc-street
# what every flag does
node scripts/verify/night-compare.mjs --help
```

### `night-refmeasure.py` -- measuring the reference PHOTOGRAPHS (added September 20 2026)

The package used to say, of itself, "Nobody measured the web photos", while the
plan's A1 gated our renders on a number taken from looking at them. This puts the
same rectangles on the photographs and divides them the same way (median linear Y).
No browser, no server: Pillow and numpy.

```bash
python scripts/verify/night-refmeasure.py                       # the ratios
python scripts/verify/night-refmeasure.py --sun                 # what regime each photo ACTUALLY is
python scripts/verify/night-refmeasure.py --overlay <scratch>/ov  # rectangles drawn on the frames
```

Regions live in `night-ref-regions.json`; the photographs live outside the repo in
`../austin-reference-images/_night/` and are never committed. **Read RATIOS off a web
photograph, never levels** -- the camera chose an exposure and both regions moved
with it. The zykov deep-night frame measures a sky at sRGB 50-62 against the
package's full-night target of 11, purely because it was shot at ISO 3200 f/2.

`--sun` is the part that found real defects. A regime tag is a word somebody wrote
down; a row in `night-routes.json` is a sun elevation. `--sun` computes the elevation
at Austin from each photograph's own stated capture time and prints it beside both.
On its first run it found a frame bound **29 degrees** from its row
(`lady-bird-lake-reflection-night__hargup`, 21:29 = sun -10.8 deg, sitting on `night`),
and a pre-dawn Capitol frame with a **black sky** (median linear Y 0.0011, sRGB code 3)
sitting on the **blue** row of two routes. 22 of the 46 photographs state no time at
all, so half the corpus cannot be checked this way and stays a judgement by eye.

**`--sun` is a gate from 2026-09-20; it used to print and exit 0.** One binding in the
file is a deliberate, argued exception — `capitol/night`, 29.2 degrees off its own
camera clock, kept because the frame's sky measures sRGB code 3 and the photographer's
caption contradicts the clock. It printed under `BOUND TO A ROW ITS OWN CLOCK PUTS IT
OUTSIDE OF` and exited 0, which is exactly what the next real regression would have
done. The difference is DECLARED now: a route carries
`refExceptions: { "<regime>": "<why>" }`, a declared gap prints **DEFENDED** and exits
0, an undeclared one prints **UNEXPLAINED** and exits **1**, and an exception naming a
regime the route does not bind is called out as stale. `refNote` cannot do this job —
nearly every route has one, so every gap read as accepted. Watched failing both ways:
with the exception removed, exit 1. What this gate does **not** cover, deliberately, is
`THE WORD AND THE CLOCK DISAGREE` — eleven `sources.json` regime tags against their own
clocks, mostly on photographs nothing is bound to. Those are printed, not gated.

`sources.json` schema (all three folders, fixed 2026-09-20): one array, snake_case,
`file`, `source_page`, `direct_image_url`, `author_credit`, `license`, `date`,
`regime`, `processing_flags` (list), `evidence` (string). `downtown/` used camelCase
and `westcampus-campus/` used `evidences` until then.

`gpu-run.mjs` is in the session's lanes scratch folder, not the repo. It holds one
of three machine-wide browser slots and passes the exit code through. Elsewhere,
run the command bare, one at a time.

What a shot is: `index.html?intro=0&drift=0&clip=1<query>`, 1440×900 at DPR 1
(`--viewport WxH` overrides it — but the tracked region rectangles are fractions read
off landscape frames, so they will not land on the same subjects in portrait: run
`--show-regions` and re-read them before quoting a ratio from another size; this was
**measured** on September 20 2026 and the answer is per-rectangle, see below),
hardware GL. The auto-detect probe is cancelled at once. The harness waits for
the veil to lift and for the authored buildings (a built group **and**
`readyToReveal()`). If the app gave up on them under load (`INTRO.authoredCeilingMs`),
it **reloads** — which is js/app.js's own documented remedy for that state — up to
twice, and only then pokes `APARTMENTS.on` back on in the abandoned page; the report
says which path it took. The poke alone is not reliable: on September 20 2026, with
all three GPU slots busy, it produced 30 `Cannot read properties of null (reading
'getLayer')` page errors and a group that never became ready inside a ten-minute
wait, and the run died before its first frame. If they never arrive it exits 2, and
the usual cause is simply a busy machine — check the slots and run it again. Each
regime is applied once. Then, per pose: jumpTo, reset the auto-exposure meter,
wait for tiles and idle, re-pose, settle 3 s, screenshot, 1 s, screenshot and
keep the second. If the two differ in more than 0.25% of pixels by more than 24
luma, it re-shoots up to twice and records the frame as unsettled if that does not
help. The camera is checked against the pose (pitch; eye altitude via `__fly.eye()`).

What it measures, per frame and per region, from the kept JPEG: `luma` (Rec.709
on graded sRGB, 0–255, the unit of the plan's §1.4 tables) and linear `Y` (the
unit for ratios): mean, p10/p50/p90, % over luma 120 and 200. Ratios are of
median Y: `wall/sky`, `ground/sky`, `water/sky`, `wall/ground`. **Bright windows:**
in the `wall` region, pixels with Y ≥ 4 × the region's median, luma ≥ 40 and
R ≥ B (the `night-luma.mjs` warm/neutral split), as a %, with their mean colour;
`absPct` is the plan's cruder "luma > 120, R ≥ B". These are pixel classes, not
truth. **A pose with no `wall` region falls back to the whole frame, and then the
number is not a window count at all** — at blue hour it is mostly sky and lit
pavement (`wc-street/rio-grande-23rd` measured 38.9% that way, all of it road).
The fallback sets `windows.fallback` in the report and prints `*` in the table and
on the tile; give the pose a `wall` region rather than quoting a starred number.

**R10, the phone pass — what it actually measured (September 20 2026).** Three
interleaved legs on a quiet machine, same poses, same regimes (`early`, `night`),
196 authored buildings confirmed on every leg: **1440×900 as shipped** (preset
`balanced`), **1440×900 `?lite=1`** (preset `performance`) and **393×852 `?lite=1`**.
Two things came out of it, and they are separable only because the middle leg
exists.

- **`?lite=1` is a different renderer, not a smaller window.** It reports preset
  `performance`: bloom 0 (from 0.4), god rays 0 (from 0.5), auto-exposure **off**,
  render scale 0.75, stars 0.5. At the same size and pose that leaves `wall/sky`
  almost untouched (3.83→3.53, 8.04→7.63, and three night poses bit-identical) but
  moves the **bright-window share up by a third at full night on every pose**
  (9.4→12.5, 13.3→16.7, 17.8→24.2, 5.6→7.1, 9.9→13.1 %). Without bloom and
  auto-exposure the lit pixels stay compact and the region median falls, so more
  pixels clear the 4× test. A phone window count is not a desktop window count.
- **The rectangles survive the portrait crop unevenly, per rectangle.** Looked at
  on `wc-elevated/over-drag-wnw`: `sky` lands entirely on clean sky (portrait has
  *more* sky above the skyline) and `ground` lands on the lit intersection, but of
  the two `wall` rectangles the left one falls completely off the tower onto haze
  and treetops and the right one is about half trees. The numbers agree:
  `wc-street/san-antonio-castilian` goes `wall/sky` 2.50 → **10.2** at early and its
  window share 23.7% → **0%** purely from the aspect change. So: `sky` and `ground`
  are reusable in portrait, `wall` is not. Re-read `wall` with `--show-regions`
  before quoting any phone ratio.

This is still desktop Chromium in a phone profile. **No frame has ever been timed on
a real iPhone**, and nothing here is a frame-rate measurement.
A/B: mean |Δluma| and % of pixels over 16 and 48, per frame. The thresholds are
the constant blocks at the top of the script.

Exit codes: **0** every shot taken and interpretable (and `--same` held); **1**
`--same` failed; **2** cannot run or cannot interpret (bad arguments, app never
ready, authored buildings missing, a pose not reached, a blank frame); **124** the
watchdog.

**Regions are drawn on one build's frames.** A change that moves a skyline or
opens up a street can push a `wall` rectangle onto sky. `--show-regions` writes
one `regions-<route>-<pose>.jpg` per pose: the frame with the rectangles drawn on
a labelled 5% grid, so the next rectangle is read off the picture rather than
guessed. Re-draw, then `--from` to re-measure the frames you already have — no app
load, about a minute for a full run.

## On-demand area attach measurement

`area-attach-meter.mjs` measures a real flight into Riverside on the normal
`index.html` city. It does not start a server. Supply two already-served URLs:

```sh
node scripts/verify/area-attach-meter.mjs --arms before=http://127.0.0.1:8472,after=http://127.0.0.1:8476 --reps 3 --vsync on --stop-after-flight --out /tmp/area-runs
```

Run it with no other GPU browser open: two at once can crash a laptop, and
they skew the frame gaps. Every arm gets a
fresh hardware-GL browser with a 300-second watchdog and a 280-second work
deadline. Repetitions alternate A,B,A,B,A,B; report the minimum
of at least three complete repetitions per arm, with the renderer, viewport,
DPR, vsync and CPU throttle. The desktop defaults are 1280x680 CSS at DPR1.5,
no CPU throttle. Vsync defaults **off**: pass `--vsync on` for a normal paced
browser. `--gpu low` rejects an NVIDIA renderer; choose an installed browser
whose Windows GPU preference actually selects the integrated GPU.

The attach window begins when the Riverside group is added and ends three
seconds after its completion log. It includes **every** upload/filter slice,
not just the final synchronous task. Include intervals that overlap this
window even when a frozen frame ends beyond its tail; end-time-only
selection can falsely report zero for a long freeze. Frame gaps include competing tile,
shader, shadow and other rendering work. Nested span durations overlap and
must not be added as exclusive costs. `--profile` adds 250-us CPU sampling;
quote it with timing and do not mix profiled and unprofiled repetitions.
Shared-machine numbers are a first look, not a quiet-machine performance verdict.

`--shots DIR` retains the second JPEG at two fixed cameras, day and night,
with matched exposure and frozen grain/twinkle. Check each shot readiness
and compare pixels **and** images; missing source tiles are not visual proof.
`--skip-geometry` omits optional retained-buffer hashing for a short capture
batch. Geometry hashes include partitions and draw groups, so changing chunk
boundaries intentionally changes them; compare expanded triangle attribute
streams separately for geometry identity. `--cycles 2` checks settled
unload/reload completeness, repeated hashes and renderer resource counts
after forced collection. Heap bytes alone cannot establish a leak.

`--phone` is Chromium emulation at 390x844 CSS/DPR3 with the authored phone
profile. It is **not** physical-device, iPhone Safari, thermal or memory-headroom
acceptance. CPU arrays freed by that profile cannot be honestly hashed; the
report distinguishes exact retained bytes from estimates.

The area scheduling knobs are `APARTMENTS.areas.sliceMs`,
`geometryChunkTris` and `yieldMaxMs`. `?areaslice=0` restores synchronous
area assembly/attach for comparison; core builds retain their existing path.
Area masks use the same complete-footprint calculation, yielding between
footprints and publishing only complete cached masks. Upload slices retain
the old fallback until the new geometry has rendered.
The time budget is cooperative: an indivisible MapLibre operation or a
competing full-city render can still exceed it. No architecture, material
or model-detail knob changes with area slicing.

## Saved browser state heals itself: `stored-state.mjs`

A hard refresh does not clear localStorage. `stored-state.mjs <outDir>` seeds
`austin3d.gfx.v1` with an out-of-range/wrong-type save, unparsable text, an
expired automatic downgrade, a fresh one, a hand-chosen `performance` and a real
old unstamped automatic `performance` save (rev 3; healed to `balanced` once, with
the probe armed: read off the page by counting the probe's own timer), each in
its own browser context before the page's scripts run, and asserts the settings
the page ends with plus that the downtown outer-ring layers still return rendered
features (and change pixels) against a clean-profile load. `--break` writes
`outerDensity 0` into the live page and must come back red: that is also the
proof the bad value hides the low-rise ring (towers and mid-rise stay). Run it
through the GPU queue; about 6 minutes.

### Does a preset hide downtown? `downtown-preset.mjs`

`downtown-preset.mjs <outDir>` loads the real page twice in one browser, once with
Performance saved and once on the default, and from three cameras (the spawn
pose, where the opening flight lands, and an eye over south campus looking at
the skyline) shoots the same frame twice (keep the second) and measures it: the
pixels each outer-ring layer covers (layer on against layer off, divided by
renderScale squared so the two canvases compare), the downtown towers with ink
standing on their ground point, every downtown name in range and on screen with
the building it names and whether the preset's own rule draws it, what render
distance hid at that altitude, and every style layer whose visibility, filter or
opacity differs between the presets. It is a measurement, not a gate. Measured
2026-10-04 (two runs, same numbers): Performance and Balanced draw the same
towers and mid-rise (full-scale pixels 10,407 against 10,531 and 5,307 against
5,145 at the south-campus camera); Performance draws about half the low-rise ring
(6,766 against 13,854, `outerDensity` 0.45); render distance 350 hides only the
clutter tiers in `js/lod.js`; none of the 28 names on screen names a building the
preset removes. So the preset alone does not leave a name over empty ground.
Through the GPU queue; about 5 minutes.

## The GL sky against the canvas sky: `sky-gl.mjs` (added October 4 2026)

`SKY_COMP.mode = 'gl'` draws the sky in the map's own pass from textures uploaded
once, and is the default; `'canvas'` (`?sky=canvas`) is the 2D canvas it replaced. `sky-gl.mjs` is the gate
for the two claims that matter: the atmosphere did not move, and a camera turn costs
no 2D draw and no upload. It reads pixels of the **finished map frame** (the harness
page, `readPixels`), never a number the sky code reports about itself.

```bash
python scripts/serve.py 8527                       # from the repo root
VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8527 node <lanes>/gpu-run.mjs --label sky-gl -- \
  node scripts/verify/sky-gl.mjs --shots <scratch>/frames     # green, plus nine labelled frames
... sky-gl.mjs --break                                       # one defect per assertion: all must go RED
... sky-gl.mjs --only c --report                             # iterate on one assertion, never fails
```

Five assertions (a atmosphere at noon, sunset and night; b no seam where the cloud
panorama wraps; c the horizon feather sits at the same row; d clouds are really
drawn and the look knob changes them; e turning costs no 2D draw and no upload) and
one about the instrument itself (g: the pixels come from the GL path). Every taste
number is in the `TUNE` block at the top of the file.

Traps this check cost time:

- **It needs a GPU.** On SwiftShader the city draws at 0.2-0.6 frames a second, so
  the screenshot and the 40-frame turn time out. That is why it is quarantined in
  `ci/checks.json` and runs on the laptop through the GPU slot.
- **A tower hides the horizon.** In a fixed column the feather was occluded in both
  modes and the assertion read 0 against 0. The check now picks the cleanest of 24
  columns from the *canvas* profile and says which one it used.
- **Luma is blind to a sunset wash.** At sunset the rose-over-blue changes colour
  without changing brightness, so the feather is measured as the summed per-channel
  distance from the same frame with the atmosphere gain at zero, not as luma.
- **A counter can lie, so there are two.** The turn assertion reads the app's own
  `SKY_METER` counters *and* a `texImage2D` wrapper this script installs itself. The
  `'canvas'` control run must show both moving or the instrument is dead.
- **Each assertion has a break switch** (atmosphere gain 1.6, seam shifted, feather
  moved 30 px, cloud gain 0, the turn run in canvas mode, the own-output run in canvas
  mode). Run `--break` after any edit to the check; a break that comes back green
  means the assertion measures nothing.

## A band's own recess switches: `inset-switches.mjs` (added October 5 2026)

A recessed band closes its recess with a soffit, a floor and a return at each
open end. A band can now leave each one out for itself
(`inset: { d, soffit, floor, returns }`, `docs/apartments.md`). The check sets
one band of The Standard's corner bay 2.0 m back in thirteen variants and counts
mesh vertices: each switch removes its own surface and nothing else, the
recessed wall never changes, and taking the inset away restores the count.

```bash
python scripts/serve.py 8447                       # from the repo root
VERIFY_URL=http://127.0.0.1:8447 node <lanes>/gpu-run.mjs --label inset-switches --   node scripts/verify/inset-switches.mjs           # about 3.6 minutes
```

Two traps it met on its first two runs:

- **`slopesApartments.rebuild()` returns before the mesh exists.** It drops the
  group and builds the new one over the next frames, so `slopesApartments.group`
  is `null` in the same `page.evaluate`. Change the data and call `rebuild()` in
  one evaluate, wait for `count.done && group`, read the mesh in a second one.
- **`APARTMENTS.insetSoffit` is city-wide.** Turning it off takes the soffit and
  the floor off every recess in the city (1,164 vertices), not off the band
  under test (12). Compare two variants under the SAME layer default.

## The sky against the world when the camera moves: `skyturn.mjs` (added October 5 2026)

The owner's words: "camera tilt and sky go in opposite directions when turning". `skyturn.mjs` measures it.
It holds the eye still (the camera is placed from a fixed eye position, so a bearing or pitch change is a pure
rotation), takes each pose twice (sky on, sky off), and reads two pictures out of the *finished map frame*:
the sky layer alone (on minus off, only where the world frame shows plain sky) and the world alone. It then
measures how far each moved, with a masked correlation searched over **both** signs, and compares both against
a pinhole model of its own whose lens comes from the page (`getVerticalFieldOfView()`), never a number typed in.

```bash
python scripts/serve.py 8527                       # from the repo root
VERIFY_URL=http://127.0.0.1:8527 node <lanes>/gpu-run.mjs --label skyturn -- node scripts/verify/skyturn.mjs
... skyturn.mjs --tier phone --report              # one tier, print the numbers and never fail
... skyturn.mjs --frames <scratch>/frames          # also write the grey pictures it measured
... skyturn.mjs --skyjs <old sky.js>               # serve another js/sky.js: this is how a BEFORE run is made
```

Nine assertions per tier, on the desktop tier (1280 x 800, DPR 1) and the phone tier (390 x 844, DPR 2, the
LITE profile at 0.75 render scale): a and a2 (the sky layer is drawn by the GL path and has cloud energy in every
pose), b and b2 (the pinhole model matches the world the app really rendered, and the rendered world rolls by the
camera's roll), c yaw 4 degrees, d yaw tilted, e pitch 4 degrees, f both together, and g **bank 5 degrees each
way**. Exit 0 pass, 1 a sky failure, 2 an instrument failure (a and b assertions), so a dead instrument cannot be
read as a sky bug.

What it found: yaw and pitch were always right (sky and world within a few percent in size and the same sign on
both tiers). The defect was bank. The flight controller banks the camera into a turn (up to `BANK_MAX` = 5
degrees, `map.setRoll`), MapLibre turns the whole picture about the frame centre, and the GL sky was built for a
level camera, so the horizon, buildings and map sky rotated while clouds, stars, horizon feather and sun stayed
level. On the old code assertion g reads: sky tilt 0.00 degrees against a world tilt of +5.00 and -5.00 (phone
+4.91 and -5.04).

Traps this check cost time:

- **`roll` is the only axis that was wrong.** Looking for "opposite directions" in yaw and pitch finds nothing.
  Measure the rotation of the picture, not just its shift.
- **The phone canvas is 1.5x dense, not 2x.** DPR 2 times the 0.75 render scale. Averaging whole-number blocks
  mis-registered the world by 25 percent and turned a pitch of 57 into 0.12; frames are now sampled at CSS pixel
  centres.
- **MapLibre's `setRoll` is called every idle frame by the flight controller** (the self-heal to level), so the
  page kit blocks it while a pose is held, or the bank is erased before the frame is read.
- **A per-half translation cannot measure a small rotation** (it gave 2.9 degrees for 5). Bank is found by a
  rigid-rotation search instead.
- **This check needs a GPU.** It asks for hardware GL itself and is listed in `ci/checks.json`.

## moire-meter.mjs: one number for moire, against a floor (2026-10-10)

`moire.mjs` scores a frame against a 3x supersampled copy on the owner's screen and needs a person to read
its heat maps. `moire-meter.mjs` is the short, headless one: ten fixed views (West Campus far/middle/near, the
Drag, campus far/low/near, downtown far/near), a table, no judgement. It draws each view at 1x and again at 4x
the pixels (`GFX.renderScale`, so the same page, atlas and camera), box-filters the 4x frame down, and reports
the error over building pixels only (mean, 99th percentile, and a 3x3-blurred "band" part), plus flicker: the
per-pixel spread of that error while the camera moves a third of a pixel per step, which cancels the true motion.
Building pixels are found by hiding the building layers and keeping what changes, split into the three.js
authored buildings and MapLibre's walls, so the table says who draws the error. The floor is the same numbers
over building pixels whose supersampled truth is flat, i.e. what the instrument reads where there is nothing to
alias; a view is "at the floor" at or under 1.5x that plus 0.15 levels. `--arms "a=js|b=js"` runs variants in ONE
page load (the switches in `js/city-lighting.js` are live), so a before/after never compares two loads.

```
python3 scripts/serve.py 8472
VERIFY_URL=http://127.0.0.1:8472 node ~/Projects/astra-pipe/tools/gpu-run.mjs --label moire -- \
  node scripts/verify/moire-meter.mjs --out <dir> --q patfilter=1 \
  --arms "off=const P=CityLighting.patternFilter;P.on=false|on=const P=CityLighting.patternFilter;P.on=true;P.scatter=true"
```

Traps met writing it: the far pattern filter is compiled only where the browser reports a graphics card, so
the software harness never has it unless `?patfilter=1`; MSAA is fixed when the map is built (`--msaa 1`
writes it into the saved settings first); a hidden-layer render only counts after `__facadePace.busy` is
false and `slopesApartments.count.done`, or the "building" mask includes a half-built city.
The meter refuses to print a result it has not earned (exit 1, or 2 for a bad flag): a view whose building mask is
empty is `--` and `n/a` in the table, out of the mean, and a failure (it used to print `0.00` and `Y/Y/Y`); `--frames`
under 2 is refused (flicker is a spread over frames, one frame gave 0); and a `settle()` that times out throws
instead of scoring a half-built city. `--from <json>` re-scores a saved `--json` run with no browser. The scoring
lives in `moire-score.mjs` (a library, also injected into the page) and `moire-score-check.mjs` runs those refusals
on synthetic inputs in CI.

`pattern-filter-taps.mjs` is the no-browser half: the filter's tap maths on three synthetic walls (two window grids,
brick), with every constant (tap caps, spacing, the scattered set, the dither hash, the morph band) READ from
`js/city-lighting.js`, so it notices drift and refuses to run on a shader shape it does not emulate. It samples every
half texel from 8 to 13 as well as 1.5 to 40. Trap it caught: the first `?patscatter=1` layout slid every tap from the
comb to the scattered set between 8 and 12 texels and was worse than BOTH layouts at 9 to 11 texels (comb 14.0, scatter
10.6, slid 22.0 at 10 x 10) while the test, which only sampled 8 and 12, printed PASS. Any slid blend is worse than the
comb somewhere, so the switch now picks the layout per pixel (a screen-space dither from 10.5 to 12.5 texels).
