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
