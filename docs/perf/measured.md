# measured.md — the first real performance record this project has

**Measured 2026-08-16 by the Acer lane, in a real browser, on the merged tree
(`acer/n1-perf` at `ca0952b`, which contains `origin/main` `6a63b4f`).**

This is the third and last document of QUEUE K1. The other two are predictions
and inventories; this one is the bill.

| | owns | status |
|---|---|---|
| `docs/perf/payload.md` | bytes and node-side parse, measured off disk | authoritative on bytes |
| `docs/perf/budget.md` | the frame budget, written by READING, nothing timed | a prediction to falsify |
| **`docs/perf/measured.md`** | **what a frame and a boot actually cost in Chrome** | **this file** |

---

## 0. READ THIS BEFORE QUOTING ANY NUMBER

### 0.1 The machine was contended, and that is not a footnote

Three sibling workflows were running and Simeon was using the laptop. Sampled
immediately before and after every reading, all night:

* **20–42 Chrome processes**, 1–4 node processes
* **CPU at the `_Total` counter: 13 % at the best moment, 91–100 % most of the
  time**, and the load probe itself (a PowerShell `Get-CimInstance` with a 15 s
  timeout) **timed out often enough that many rows print `cpu -1%` — a failed
  load probe is itself a load reading.**

Consequences, stated once and true everywhere below:

* **Wall-clock frame time is NOT MEASURABLE TONIGHT to a useful precision.**
  Identical configurations, interleaved and counterbalanced, came back 2.3×,
  3.2× and **10.5×** apart (`phone-night`: 683.5 ms best-frame in rep 1 and
  65.4 ms in rep 2). Section 2 prints those numbers because the *ordering*
  survives and the minimum is a real ceiling on speed, but there is no honest
  headline fps figure in this document and I have not invented one.
* **CPU-timer and profiler numbers DO survive**, because they measure work
  done, not time elapsed, and because a *share of main-thread time* is a ratio.
  Sections 1, 3 and 4 carry this report. Section 2 is the weakest section here
  and is labelled as such.

### 0.2 The instruments, and what each of them gets wrong

* **`scripts/verify/perf.mjs` throttles the CPU 4× unless told otherwise.**
  **It was not used for anything in this document.** Every figure here is
  UNTHROTTLED. Multiply by roughly 4 to compare against anything that script has
  ever printed, and remember a mid-range phone is worse than either.
* **`scripts/serve.py` does not gzip; GitHub Pages does** (~5–6× on our GeoJSON,
  measured in `payload.md`). Every byte figure below is the local uncompressed
  wire cost and is therefore a worst case.
* **A page-scoped CDP session cannot see MapLibre's worker fetches.** MapLibre
  fetches vector tiles inside its workers, and those never enter the page's
  resource timeline. The repo documents the gap at ~19 MB. Section 4's transfer
  column is explicitly labelled PAGE-SCOPED for this reason and is not a total.
* **Hardware GL, not SwiftShader.** Probed and printed: headless and headed both
  resolve to `ANGLE (NVIDIA GeForce RTX 3050 Ti Laptop GPU, Direct3D11)`. This
  matters — the suite's default `--use-angle=swiftshader` rasterises on the CPU
  and would report a geometry change as free.
* **Headless, not headed.** `README` mandates headed for timing because
  SwiftShader is the alternative. It is not the alternative here: the renderer
  probe above shows headless gets the same discrete GPU, and a headed window
  stealing focus for forty minutes would have corrupted three sibling
  workflows' screenshots and Simeon's evening. Occlusion flags are passed
  anyway (`--disable-backgrounding-occluded-windows`,
  `--disable-features=CalculateNativeWinOcclusion`, …).
* **`window.cancelGraphicsAutoDetect()` at the top of every single run.**
* Fixed graphics settings written to `localStorage` before load (balanced
  preset, MSAA off, render scale 1) so nothing drifts mid-suite.
* **`index.html?intro=0&drift=0`, never `_harness.html`** — its rAF shim pins
  the loop at ~60 Hz and would report every configuration as identical.
  `drift=0` because the idle attract loop flies the camera after 25 s.
* **Minimum of interleaved, counterbalanced reps.** Never a mean, never one
  reading.

---

## 1. THE HEADLINE: WHERE THE MAIN THREAD GOES

Instrument: **Chrome's own V8 sampling profiler over CDP**, 100 µs interval,
running while a scripted camera sweep drives the map. It touches no source file,
which is what makes it usable tonight — `js/sky.js` and `js/controls.js` belong
to other lanes and could not be hand-instrumented.

What a sampling profiler gets wrong: it attributes to whatever is on top of the
stack, so a hot callee steals from its caller; SELF is the honest column and
SUBTREE double-counts nothing but is easy to misread; anonymous closures land as
`(anonymous)` plus a `url:line`; and the profiler itself costs a few percent, so
these are upper bounds. **It cannot see the GPU or MapLibre's workers at all.**

Because absolute ms are contaminated tonight, every figure below is quoted as a
**share of total sampled main-thread time**, which is a ratio and survives.

### 1.1 The table

| | cruise day p0.30 | walk 1.7 m dusk p0.62 | walk 1.7 m night p0.92 | phone dusk p0.62 |
|---|---:|---:|---:|---:|
| sampled wall | 13.1 s / 41 frames | 15.6 s / 47 | 16.2 s / 18 | 16.1 s / 48 |
| MapLibre `_render` subtree | 60.9 % | 64.3 % | 58.3 % | 56.3 % |
| **atlas image work** ¹ | **19.1 %** | **20.3 %** | **16.5 %** | **15.2 %** |
| shader/program queries ² | 15.9 % | 7.3 % | 6.6 % | 4.0 % |
| **`updateSky` (js/sky.js)** | **8.8 %** | **8.3 %** | **5.6 %** | **6.0 %** |
| whole `jumpTo` cascade | 9.5 % | 10.0 % | 6.6 % | 8.1 % |
| garbage collector | 3.3 % | 9.0 % | 13.0 % | **19.1 %** |
| `tick` (js/controls.js) ³ | 2.1 % | 3.9 % | 0.7 % | 5.6 % |

¹ `getImageData` + MapLibre `patchUpdatedImages` + `getImage` + `_getImagesForIds`.
² `getProgramParameter` + `getShaderParameter` — synchronous GL queries, i.e.
program compile/link status.
³ the flight tick MINUS the `jumpTo` it normally ends in; the sweep calls
`jumpTo` itself, so the two are separated here for the first time.

### 1.2 Four findings, in order of size

**FINDING 1 — the sky canvas is the biggest thing we own, and §128 called it.**
`docs/perf/budget.md` §128 predicted `updateSky` at **2–8 ms per frame** and
attached a falsifier: *"if it measures under 1 ms the section is wrong and
should be struck."* It measured **8.8 % of all main-thread time at cruise, 8.3 %
at dusk at 1.7 m** and never went under 5.6 %. The falsifier is not met; the
section stands.

The sharper form of the same number: **`updateSky` is 93 % of the entire
`jumpTo` event cascade at cruise (1158.9 ms of 1250.0 ms) and 84 % of it at
dusk.** Everything else registered on `move` — the entrances label gate,
`js/outer.js`'s opacity bucket, the rest — is rounding error beside it. If you
want the per-camera-move cost down, there is exactly one thing to fix.

**FINDING 2 — the facade/sprite atlas is BIGGER than the sky, and nobody had
costed it at all.** 15–20 % of main-thread time in `getImageData` +
`patchUpdatedImages` + `getImage`. `js/facades.js:291` already names
`getImageData` as the slowest common canvas2d op; `js/facades.js:1437` is the
readback. This is not the 4-per-second time-of-day repaint — the time of day was
forced ONCE and then held constant in every capture. It is the cost of new
facade combos entering view during flight and being rasterised and re-uploaded.
**It is the largest single block of cost this project has ever left unexamined.**

**FINDING 3 — 16 % of a cruise frame is spent asking the GL driver whether a
shader compiled.** `getProgramParameter` and `getShaderParameter` are
synchronous, pipeline-stalling queries. With **219 style layers** and
data-driven pattern expressions, MapLibre is compiling programs *during flight*,
not at load. It is worst at cruise-day (15.9 %) and falls to 4 % on the phone
viewport. Not mentioned anywhere in this repo before tonight.

**FINDING 4 — the flight tick is not the problem, and the budget's G1 line is
misattributed.** `scripts/verify/perf-budget.mjs` fails G1: across **five cruise
reps tonight** the differenced `tickMsAvg` read 8.308 / 19.975 / 21.341 /
26.7¹ / 39.494 ms, **minimum 8.308 ms against a 1.5 ms budget — 5.5× over.**
But `tickMsAcc` in `js/controls.js:1670` brackets `writeToMap()`, which ends in
`map.jumpTo(pose)` — so **G1 has never measured `js/controls.js`; it measures
the flight tick PLUS the whole MapLibre event cascade PLUS every listener
anyone has ever registered on `move`.** Separated by the profiler, the tick's
own work is **0.7 %–5.6 %** of main-thread time. G1's overrun belongs to
FINDING 1, not to the movement code, and the 1.0 ms slice `budget.md` §4.2
assigns to `controls.js` is measuring something else entirely.

¹ approximate — that rep's row printed the tick alongside a load probe that had
already timed out.

---

## 2. FRAME TIME — the weakest section in this document

**Read §0.1 first. These are ceilings on speed, not costs.** Minimum across 3
interleaved counterbalanced reps (2 for phone — the 30-minute watchdog took the
last two captures). 10 s wall pass plus a 5 s GPU-stalled pass (a 1×1
`readPixels` at the end of each `render`, which cannot return until the GPU has
finished, so it converts "how fast can the CPU submit" into "how long did the
GPU take"). 1440×900, phone 390×844. Dropped frames counted against a 16.67 ms
target.

| condition | best frame | median | dropped/s | GPU best | rep spread |
|---|---:|---:|---:|---:|---:|
| cruise day | 59.8 ms | 124.0 | 52.6 | 91.7 | 2.3× |
| cruise night | 35.8 ms | 54.0 | 38.5 | 38.6 | 4.0× |
| walk 1.7 m day | 47.7 ms | 108.0 | 53.8 | 88.1 | 2.3× |
| walk 1.7 m night | **17.8 ms** | 35.9 | 24.8 | 27.4 | 3.2× |
| phone day | 84.1 ms | 224.9 | 56.9 | 98.1 | 2.0× |
| phone night | 65.4 ms | 140.5 | 54.0 | 64.4 | **10.5×** |

**What can honestly be said from this:**

* **Night is cheaper than day, everywhere.** Best-frame night beats best-frame
  day at cruise (35.8 vs 59.8) and at walking height (17.8 vs 47.7), in the same
  interleaved runs. Shadows and the day sky are the difference.
* **The best frame the app produced all night was 17.8 ms**, at walking height
  at night. That is one frame at 56 fps under contention, so the app is capable
  of 60 fps somewhere.
* **Everything else dropped frames continuously** — 24.8 to 56.9 dropped frames
  per second, i.e. the app was under a third of 60 fps at every other pose even
  taking the best rep.
* **Nothing here separates the app from the machine.** The 10.5× rep spread on
  one condition is larger than any difference between conditions. **This table
  must be re-run on a quiet machine before anyone plans work from it.**

**AND ONE DEFECT IN MY OWN INSTRUMENT, FOUND BY LOOKING AT THE FRAME.**
`shots/perf/cond-walk-dusk.png` shows what the two `walk` rows were actually
rendering: **the eye at 1.7 m on Guadalupe ends up pressed flat against the
face of Walter Webb Hall**, with a single facade filling most of the viewport.
That is far *cheaper* than a street, so **the `walk` rows understate walking
height and must not be quoted as "the city at eye level".** The frame is in
`shots/perf/` on purpose — it is the evidence that the number is wrong, and
finding it took one look at a picture after four hours of clocks. Whoever
re-runs this needs an eye pose chosen against a rendered frame, not against a
coordinate.

The `cruise` and `phone` rows do not have this problem —
`shots/perf/cond-cruise-day.png` is the whole city with downtown on the horizon,
which is the frame those numbers describe.

---

## 3. THE THREE HOGS

### 3.1 Why they had to be measured without a walk

`scripts/verify/perf-budget.mjs` asks the app to WALK, and **the app cannot
walk.** Tonight, on all three interleaved reps, a held-W sprint south down
Guadalupe from 1.7 m travelled its 120 m and **ended at altitude 23.8 m** —
identical to the digit on every rep, so this is a mechanism and not noise. Above
`TRUNK_ALT` (12 m) the trunk field switches off, so a lifted walk measures a
subsystem that is not running. The gate correctly reports **G2, G4 and G5b as
INVALID and prints no figure**, which is the right behaviour and is not a pass.

That is QUEUE **Y16**'s silent lift, reached through the movement path instead
of through `setPitch`, and it is now blocking a measurement as well as a camera.

So both scans were driven directly through the app's own entry points —
`__fly.outerScan()` and `__fly.trunkScan()`, which reset the throttle and
re-enter the real unbounded `querySourceFeatures` path (this is what the gate's
own `--prove` mode does) — in two regimes:

* **TELEPORT** — jump 1–2 km, then scan. Every bucket is cold. This is §109's
  841.5 ms methodology and it is an upper bound.
* **HOP** — jump exactly one rescan trigger (60 m trunks, 200 m ring), then
  scan. **This is what a real walk or flight actually pays, and nobody had ever
  measured it.**

Both timed twice at once: the app's own `performance.now()` pair
(`trunkField().maxMs` / `outerField().maxMs`) and a wall-clock bracket in the
harness. Own page load per run, because those maxima are cumulative and cannot
be differenced.

### 3.2 Y7 — the outer-ring scan. REPRODUCED, and marginally worse than §109.

| how it was triggered | worst scan | field |
|---|---:|---:|
| §109, for the record | 37.9 ms | — |
| naturally, 1,500 m cruise at 420 m (`perf-budget.mjs`, min of 3) | **43.3 ms** | 729–1,356 features |
| naturally, 200 m hops at 1.7 m (min of 3) | **40.1 ms** | 6,815 features |
| forced full rescan after a 1–2 km teleport at 1.7 m (min of 3) | 27.2 ms | 5,356 |
| forced full rescan at 420 m (min of 2) | 487.9 ms | 1,356 |

**The claim that survives the noise: the outer-ring scan lands at ~40 ms on
every honest reading, in both regimes, which is two-and-a-half dropped frames,
and it has never once come in under its 8 ms budget on any machine state anybody
has tested.** The other reps of the same conditions read 83.2, 163.9, 248.7,
348.4 and 674.2 ms; those are the machine, and the minimum is the code.

**Y7 IS NOT FIXED AND NOTHING WAS CHANGED TONIGHT.** It lives in
`js/controls.js`, which another lane held.

### 3.3 Y15 — the trunk field. 841.5 ms DID NOT REPRODUCE.

| how it was triggered | worst scan | trunks in field |
|---|---:|---:|
| §109, ten teleports across West Campus | 841.5 ms | 2,976 |
| forced rescan after a 1–2 km teleport (min of 3 reps) | **89.9 ms** | 3,786–5,416 |
| forced rescan after one 60 m hop — a real walk's unit (min of 3) | **149.8 ms** | 2,839–4,026 |

**Restate Y15 with these numbers.** The worst trunk scan measurable tonight is
**149.8 ms, not 841.5 ms** — still nine dropped frames and still 19× the 8 ms
budget, but an order of magnitude below the figure in the QUEUE, and it arrives
in the regime a real walk actually produces rather than in a teleport. §109's
841.5 ms should be read as a stale upper bound from a different tree density,
not as today's cost. Other reps read 235.8, 439.8, 522.7 and 543.9 ms; the
machine was at 100 % CPU for most of them.

**Y15 IS NOT FIXED AND NOTHING WAS CHANGED TONIGHT.** Same file, same other
lane.

### 3.4 The third hog is the one nobody had a number for, and it is bigger

See §1.2 FINDING 1. **`updateSky` is 8.8 % of main-thread time at cruise and 93 %
of everything that runs on a camera move.** Y7 fires roughly once per 200 m and
Y15 once per 60 m; `updateSky` fires **every single frame the camera moves**, at
its largest canvas size exactly at walking height, where the horizon sits
highest in frame. On a 60 fps budget that is a bigger total bill than both scans
put together, and unlike them it has no instrument, no counter and no throttle.

**Ranked, with everything measured tonight in one list:**

| | what it costs | how often | who owns it |
|---|---|---|---|
| 1 | atlas image work, 15–20 % of main thread | every frame in motion | `js/facades.js` |
| 2 | `updateSky`, 6–9 % of main thread | every camera move | `js/sky.js` |
| 3 | shader/program queries, 4–16 % | every frame at cruise | MapLibre + our 219 layers |
| 4 | Y7 outer scan, ~40 ms | once per 200 m | `js/controls.js` |
| 5 | Y15 trunk scan, ~150 ms | once per 60 m at 1.7 m | `js/controls.js` |

---

## 4. BOOT — and the picture of Simeon's actual complaint

Three cold loads: **fresh browser context, HTTP cache disabled**, hardware GL,
no CPU throttle, `scripts/serve.py` on 8352 (**no gzip**). Minimum of the three.

### 4.1 The timeline

| | min of 3 | other reps |
|---|---:|---|
| DOMContentLoaded | **454 ms** | 455, 458 |
| `window.load` | **455 ms** | — |
| map `'load'` fired | **2,676 ms** | 5,008 / 19,780 |
| first `idle` | **21,568 ms** | 53,055 / never within 90 s |

### 4.2 MAIN-THREAD PARSE AND EXECUTE — the number nobody had ever taken

Instrument: CDP `Performance.getMetrics()` plus a `PerformanceObserver` on
`longtask` installed before any of our code runs.

**In the first 8 seconds of a cold load the main thread is blocked by long
tasks for 7,072 ms — 88 % of the wall clock.** Fifteen tasks over 50 ms, and

> **the worst single blocking task is 2,744 ms, starting at t = 2,652 ms —
> immediately after map `'load'`.** The other two reps put that same task at
> 5,135 ms and 13,152 ms.

The full first-8-s ladder, minimum rep (start + duration, ms):
`213+137 · 364+50 · 459+847 · 1652+73 · 2053+242 · 2490+93 · 2652+2744 ·
5498+850 · 6450+116 · 6673+71 · 6857+173 · 7168+152 · 7321+57 · 7504+70 ·
7575+1397`

Over the whole 28 s the page was held: **89 long tasks, 18,010 ms of blocking**,
and they never stop — from 20 s to 28 s there is a continuous run of 50–200 ms
tasks. `Performance.getMetrics()` over the same window: `ScriptDuration`
**15,363 ms**, `TaskDuration` **29,265 ms**, layout 131 ms, style recalc 54 ms,
JS heap 57.6 MB. **Those last figures cover ~90 s of page life, not just boot —
the poll loop ran to its deadline — so read them as an upper bound and read the
long-task ladder as the boot figure.**

For scale: `payload.md`'s node-side `JSON.parse` numbers for the same files are
14.7 ms (buildings), 20.1 ms (roofs) and so on. **The 2,744 ms freeze is
therefore NOT JSON parsing.** Parsing is a rounding error; the cost is what
happens after it — `addSource`, style construction, the facade atlas build.
That is a new fact and it changes where a loading fix should go.

### 4.3 Bytes

| | measured |
|---|---:|
| page-scoped transfer, cold, cache disabled | **16.34 MB** |
| of which `data/` | 14.99 MB over 102 requests |
| of which `js/` | 1.30 MB over 27 requests |
| `style.css` | 0.05 MB |
| third-party (unpkg, openfreemap) | **10 requests, 0.00 MB reported** |

**Every one of those numbers is wrong in a known direction and both of them
matter:**

* **UNGZIPPED.** `serve.py` does not compress; GitHub Pages does, at ~5–6× on
  our GeoJSON (`payload.md`). The real visitor's `data/` figure is far smaller.
  **`payload.md` owns the byte bill and wins wherever the two touch.**
* **PAGE-SCOPED, so it UNDER-reports.** MapLibre fetches vector tiles in its
  workers and those never enter the page's resource timeline; the repo puts the
  gap at ~19 MB. And the ten third-party requests report `transferSize` 0
  because cross-origin responses without `Timing-Allow-Origin` are opaque —
  **the maplibre bundle, the pmtiles library and the entire OpenFreeMap basemap
  are in that 0.00 MB.**

So: **16.34 MB is a floor on our own origin, uncompressed. It is not a total,
and no total was established tonight.**

### 4.4 TIME TO A POPULATED DOWNTOWN — photographed

`shots/perf/boot-downtown-*.png`, one cold load, same camera, timestamped from
navigation start. The automated detector for this failed (see §6) so **this was
read by looking at the frames**, which is what CLAUDE.md rule 10 asks for
anyway.

| t | what is on screen |
|---|---|
| 1 s, 2 s, 4 s | the loading veil. At 4 s it reads **"READING THE CITY — 7 %"** |
| **8 s** | **veil gone, city FLAT.** Coloured footprints, zero extrusion, no trees, no labels. This is the frame QUEUE K1 describes. |
| 16 s | campus and West Campus fully built — **and the downtown horizon is still empty** |
| **24 s** | downtown towers finally on the skyline |

**Time to a populated downtown: between 16 and 24 seconds on a cold load, and
there is a window from roughly 5 s to 16 s in which the app is on screen,
interactive, and showing a city that is not there.** The veil lifting is not the
problem — it lifts honestly at 7 % and hands over. What follows it is.

Machine load during that load: 32→35 Chrome processes, CPU 61 %→100 %. On a
quiet machine this will be faster; nothing about the SHAPE of it changes,
because the shape is the order in which sources are added.

---

## 5. THE GATE — `scripts/verify/perf-budget.mjs` does NOT pass, and that is correct

Run twice tonight on the merged tree (`ca0952b`), 3 reps then 2 reps.

**RED, on the shipped budget:**

```
FAIL  G1   controls tick at cruise            19.975 ms (differenced) vs 1.5 ms
----  G2   controls tick at 1.7 m             phase did not run far enough to measure
FAIL  G3   outer-ring scan worst case (Y7)    43.30 ms vs 8 ms
----  G4   trunk field scan worst case (Y15)  phase did not run far enough to measure
FAIL  G5a  outer scan duty cycle              2.06 % of wall time vs 0.53 %
----  G5b  trunk scan duty cycle              phase did not run far enough to measure
G7 style layers: 219 — RECORDED, not gated
```

**GREEN, same code, same tree, budget thresholds raised through the env
overrides the script already carries (`PB_OUTER_MS=400 PB_TRUNK_MS=400
PB_TICK_CRUISE=45 PB_TICK_WALK=45 PB_DUTY_PCT=30`):**

```
 ok   G1   controls tick at cruise             8.308 ms vs 45 ms
 ok   G3   outer-ring scan worst case (Y7)   261.20 ms vs 400 ms
 ok   G5a  outer scan duty cycle               3.23 % vs 30.00 %
PASS  all 3 judged assertions
```

**So the gate is not stuck.** It has now been watched failing on the real
overrun and watched passing on the same build, which is the only way to know a
guard works. And in both runs it **refused to report the walk** — G2, G4 and
G5b came back `INVALID`, printed no figure, and said so, because the walk phase
never stayed at walking height. A guard that prints a clean number for a phase
that did not happen is worse than no guard; this one does not.

**It should stay red.** The budget in `docs/perf/budget.md` was written on
purpose as the number a fix has to hit, not as a description of today. Do not
re-baseline it to tonight's readings — that would convert the one honest signal
this project has into a rubber stamp. **This lane could not change it anyway:
`scripts/verify/` was not in this pass's write scope.**

---

## 6. WHAT IS STILL UNBUDGETED, AND WHAT I FAILED TO ESTABLISH

**Failures of this pass, listed first because they are the part most likely to
be misread as absence of a problem.**

1. **No fix was written and no before/after exists.** Y7 and Y15 both live in
   `js/controls.js`; the sky redraw lives in `js/sky.js`; the atlas lives in
   `js/facades.js`. All three files belonged to other lanes tonight and this
   pass's write scope was `docs/perf/measured.md`, `shots/perf/`, `QUEUE.md`
   and `HANDOFF.md`. **Every "after" column in this document would have been a
   fabrication, so there is none.** This is a measurement pass, full stop.
2. **Frame time is not established.** §2 is ceilings under 2–10× rep noise on a
   machine at 91–100 % CPU. There is no fps figure in this document.
3. **`querySourceFeatures('austin-buildings')` returned 0 on every sample of
   every boot rep**, in a browser that was visibly drawing thousands of
   buildings from that exact source (`shots/perf/boot-downtown-24s-*.png`). The
   automated populated-downtown detector was built on it and never fired. §4.4
   was read off the frames instead. **Why that call returns 0 is unexplained and
   is a live trap for the next lane** — the README already warns that
   `queryRenderedFeatures` lies about fill-extrusion; this is a second, separate
   query that also cannot be trusted here.
4. **My seeded camera pose was silently overridden.** `boot.mjs` jumps to a
   downtown pose the instant `window.__map` exists and again on `'load'`; every
   frame came back at the app's default spawn. That is the README's own
   "the controller owns the camera" trap, and it means §4.4 describes the
   DEFAULT view, not a chosen one. It is arguably the better metric — it is what
   a visitor sees — but it is not what was asked for.
5. **Total wire bytes are not established** (§4.3): page-scoped, ungzipped, and
   third-party opaque. `payload.md` remains the authority.
6. **Nothing was measured on a phone, a weak GPU, or a throttled CPU.** The
   `phone` rows are a 390×844 viewport on an RTX 3050 Ti. A real phone is worse
   by an unknown factor; the 19 % GC share in that column is the only hint.
7. **`js/shadows.js` (2,428 convex hulls per rebuild) and the 4-per-second
   time-of-day heavy tick were NOT measured.** Both need the autoplay clock
   running; every capture here held `p` constant on purpose so the frame numbers
   would be comparable. `budget.md` §128 predicts them and they are still
   predictions. **"Autoplay while walking" remains the worst state the app can
   be in and remains unmeasured.**
8. The A/B on the levers that already ship (`?outer=0`, the `performance`
   preset, post-process off) was written and not run — the machine ran out of
   quiet before it did. `scratchpad/ab.mjs` in this session; rebuild it, it is
   thirty lines of harness around the same sweep.

**Still unbudgeted, in the order a fix should take them:**

| | what | why it is first |
|---|---|---|
| 1 | **boot: the 2,744 ms freeze after map `load`, and 7.07 s of blocking in the first 8 s** | it is the biggest single number in this document and it is the one Simeon has actually complained about |
| 2 | **the facade atlas, 15–20 % of every moving frame** | largest steady-state cost we own, and nobody had looked |
| 3 | **`updateSky`, 93 % of the per-camera-move cost** | one function, one throttle, §128 already wrote the fix |
| 4 | Y7 ~40 ms per 200 m, Y15 ~150 ms per 60 m | real, repeatable, but rarer than 1–3 |
| 5 | 219 style layers and mid-flight shader compilation | 16 % of a cruise frame; no idea yet what is compilable at load |
