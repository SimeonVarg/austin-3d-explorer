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

## Running

Serve the repo root on port 8099 first, from the repo root:

```bash
python -m http.server 8099 --bind 127.0.0.1
```

Then, from `scripts/verify`:

```bash
node movement.mjs      # camera: symmetry, vertical control, momentum, stuck keys (14 assertions)
node collision.mjs     # never inside a building, streets stay flyable, joystick+look (8 assertions)
node sky.mjs           # one-sun coherence, disc projection, blend invariants (12 assertions)
node dusk.mjs          # the dusk handover must be continuous (prints worst frame-to-frame change)
node silhouette.mjs    # the skyline must read DARK against the sky at dusk and night
node banding.mjs       # 8-bit banding in the sky gradient + sky overlay cost
node shot.mjs <prefix> [shots.json]   # screenshots at named camera poses
```

`movement.mjs` accepts `--report` to print the table without failing.

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
