# Verification harness

Drives the **real** `index.html` in headless Chrome and asserts measurable
properties of the scene. This exists because this project has repeatedly been
burned by fixes that were shipped on reasoning alone and missed — see
`HANDOFF.md` §8. It lived in an ephemeral scratchpad once and was lost; that cost
real hours. It is in the repo now on purpose.

It is dev-only tooling. It adds no build step and no runtime dependency to the
site — the site is still plain static HTML/CSS/JS served from the repo root.

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

### The core gates

```bash
node movement.mjs      # camera: symmetry, vertical control, momentum, stuck keys (14 assertions)
node collision.mjs     # never inside a building, streets stay flyable, joystick+look (8 assertions)
node walk.mjs          # a scripted walk really walks, at 1.7 m, and can be watched failing
node sky.mjs           # one-sun coherence, disc projection, blend invariants (12 assertions)
node dusk.mjs          # the dusk handover is continuous, measured in PIXELS across a p sweep
node night-silhouette.mjs   # the skyline reads DARK against the sky at dusk and night
node banding.mjs       # the sky gradient is still a gradient + updateSky cost
node shot.mjs <prefix> [shots.json]   # screenshots at named camera poses
```

`movement.mjs`, `dusk.mjs` and `banding.mjs` accept `--report` to print the
table without failing.

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
```

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
three.js `custom` / `renderingMode: '3d'` layer that will carry the real
pitched roofs, the Capitol dome and the arches. `slopes-layer.mjs` proves,
from pixels on the real page, that a mesh in it is treated exactly like the
fill-extrusion beside it, and that switched off it leaves a frame identical to
the one it was never in.

```bash
VERIFY_URL=http://127.0.0.1:8442 node slopes-layer.mjs                 # the gate
VERIFY_URL=http://127.0.0.1:8442 node slopes-layer.mjs --break         # must go red on stack + haze
VERIFY_URL=http://127.0.0.1:8442 node slopes-layer.mjs --shots DIR --against http://127.0.0.1:8443
```

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
- **Budget: 10-12 minutes** — three full page loads and nine poses. Run it in
  the background if your shell has a shorter ceiling; the watchdog is 900 s.

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
