# The twelve reds — part one: the six real assertion failures

**2026-08-16, acer lane.** HANDOFF §155 left the suite honest for the first time
— 38 gates, 25 green, 12 red — and nobody had read the twelve. This document is
the six that §155 classified as *real assertion failures*. It diagnoses; it
fixes nothing.

Method: throwaway worktree off `origin/main` `279a967`, `python scripts/serve.py
8511`, `harness-drift.mjs` **PASS (29/29 scripts both documents)** before any
pixel was read. Every page load carries `?drift=0` and cancels the graphics
auto-detect probe. Every gate was run at least twice; nothing below rests on one
reading.

---

## The finding, in one line

**All six are the instrument. None of them is the app.** Zero of the six
describes anything a visitor could see, and the two that turned out to be
photographable defects — the Capitol grounds "never merging" and the LBJ's
undercroft — are photographed here doing exactly what they are supposed to do.

That is a bigger claim than §155's "expect roughly half", so each one below
carries the measurement that settles it, and the four things I did **not**
establish are listed at the end.

**None of the six is new.** Four of them have a dated red in this repo's own
HANDOFF from two weeks ago:

| gate | first recorded red | age tonight |
|---|---|---|
| `graphics` 26/27 | §24, Aug 1 2026 | 15 days |
| `arts-check` 27/28 | §24, Aug 1 2026 | 15 days |
| `capitol-merge` | §49 Aug 3 (diagnosed), §80 Aug 4 (red) | 13 days |
| `light-ae` | not recorded before §155; its guard was written 2026-07-30 | ~17 days, inferred |
| `orbit-check` | not recorded before §155; flaky by construction since the feature landed | — |
| `light-probe` | not recorded before §155; flaky by construction | — |

Nothing broke in the last day. Every one of these was invisible because the
gates could not exit non-zero, or because nobody ran them, which is precisely
what §155 fixed.

---

## Ranked by whether a visitor would ever notice

All six rank **zero**. There is no ordering by visitor impact to give, so they
are ordered below by how much damage the *red* itself does — a gate that is
permanently red trains people to ignore it, and this repo has four documented
cases of a guard that could not see what it guarded.

---

### 1. `capitol-merge` — a checker keyed on names the app stopped using

**Verdict: INSTRUMENT. Stale since the Capitol got its own sources. Correct
version: GREEN.**

Reproduced twice, identical. The gate prints:

```
path taken            NEITHER - merge never ran
trees in Capitol box  0        (need >= 100)
ground in Capitol box 2512     (need >= 200)
```

It asks two questions and both of them are about a design that was replaced:

1. it greps the console for `/appended to/`, the log line from the
   `updateData({ add })` path;
2. it counts `austin-trees` and `austin-ground` inside the Capitol box.

`js/capitol.js` now gives the Capitol grounds and trees **their own sources**
via `map.addSource` — `austin-capitol-ground` (line 449) and
`austin-trees-capitol` (line 510) — and records what it did in
`window.__capitolMerge`. Counted against the sources that exist, at the gate's
own pose and inside the gate's own box:

| source | features in the box |
|---|---|
| `austin-trees` | **0** |
| `austin-ground` | 2512 |
| `austin-trees-capitol` | **1483** |
| `austin-capitol-ground` | **2722** |
| `austin-capitol-dome` | 134 |

drawn by five visible layers (`capitol-ground-areas`, `-texture`, `-paths`,
`trees-trunk-capitol`, `trees-canopy-capitol`), with

```json
{ "austin-capitol-ground": { "how": "own layers over outer-detail", "area": 322, "patharea": 839 },
  "austin-trees-capitol":  { "how": "own source, 2 cloned layers", "features": 612 } }
```

The app's own console *says so in the line the gate ignores*:

> `[capitol] 612 grounds trees on 2 cloned layers (austin-trees draws none here: 0 magenta px over the south lawn)`

The zero the gate reports is the app telling it, correctly, that it is reading
the wrong source.

**This was already written down.** HANDOFF §49 (Aug 3): *"`capitol-merge.mjs`
asserts a console string for a code path that no longer exists, and must be
rewritten to read `window.__capitolMerge` and to count inside the Capitol's own
sources … It was outside this lane's writable set."* It has sat unclaimed for
thirteen days. This is the second unclaimed lane handoff §155 found in the
verify directory, after the coplanar baseline.

**The photograph.** `shots/reds/capitol-grounds.png` — the gate's own pose. The
dome, the grove, the radiating walks, all of it. Nothing is missing.

---

### 2. `light-ae` — a gate that cannot pass on the renderer the suite uses

**Verdict: INSTRUMENT, twice over. One failure is red by construction. Correct
version: GREEN.**

Two readings; the second, run alone on an idle machine, was *worse* (6/8) than
the first run under contention (7/8) — which is already a sign that the
assertion is measuring the machine.

**Failure A — "no pumping: settled gain spread < 0.02 wherever measurable".**
The check is

```js
const judged = traces.filter(r => r.frames >= 5);
check(..., judged.length >= 1 && judged.every(r => r.settleSpread < 0.02), ...)
```

`meter()` drives `updateSky` inside `requestAnimationFrame` for 3200 ms.
Headless SwiftShader delivered **2, 3, 3, 4** frames (run 1) and **1, 4, 4, 1**
(run 2). `judged.length` is therefore 0, and `0 >= 1` is false. **The gate is
red whatever the app does**, on the renderer the entire suite is built on. Its
own header comment admits the dependency — *"Only meaningful where swiftshader
managed >= 5 frames"* — and then makes the unmet precondition a failure instead
of a skip.

And there is nothing to find: `settleSpread` was **0.0000 in all eight poses of
both runs**.

**The discriminator.** Drive the identical meter by iteration count instead of by
clock, at the same pose:

| iterations | gain | spread | "lifts UP" |
|---|---|---|---|
| 1 | 1.2000 | 0.0000 | PASS |
| 2 | 1.0601 | 0.0000 | PASS |
| 4 | 1.0601 | 0.0000 | PASS |
| 8 | 1.0601 | 0.0000 | PASS |
| 16 | 1.0601 | 0.0000 | PASS |
| 32 | 1.0601 | 0.0000 | PASS |
| 60 | 1.0601 | 0.0000 | PASS |
| 120 | 1.0601 | 0.0000 | PASS |

The EMA converges on the **second** step and is then bit-identical out to 120.
The auto-exposure does not pump. The gate was starved of frames, not shown a
defect.

**Failure B — "darker-than-typical frame: exposure lifts UP"**, which appeared
only in the idle run. It needs `gain > 1.05`; readings were **1.0602, 1.0602,
1.0447**, driven by a metered luma that moved 0.1058 → 0.1081 between frames. A
0.01 margin on a noisy single-frame luma read. Same root cause: one frame is not
a measurement.

---

### 3. `arts-check` — the LBJ is judged by a percentile that sits outside the thing it names

**Verdict: INSTRUMENT. The threshold was set without measuring. Correct version:
green, but only just — 2.03x against a bar of 2.0.**

The one red assertion, stable to the digit across three readings two weeks apart
(§24 Aug 1, §155 tonight, and twice here):

```
FAIL  LBJ: the sunlit travertine is more than twice the luma of its own undercroft
      [0.438 / 0.262 = 1.67x]
```

Instrumenting `arts-check.mjs` itself — same code path, same mask, same 11455
masked pixels — gives the numbers the gate does not print:

```
p98 0.4376   med 0.4376   p90 0.4376   p05 0.2625   p02 0.2151   p01 0.2151   min 0.2151
dark band 5.07% of pixels, mean 0.2209
distinct luma levels in the whole mask: 11
```

Two things are wrong with the ruler, and neither is about the building.

**The numerator is capped by construction.** `p98 == p90 == the median`. The top
half of the LBJ's masked pixels are a *single* luma value, because
`fill-extrusion-vertical-gradient` is **off** on that layer — which
`arts-check.mjs` asserts as correct two lines earlier. There is no highlight to
find; "the sunlit travertine" is the modal face value and cannot be anything
else.

**The denominator is measured on the undercroft's bright edge.** The dark band
is **5.07%** of the masked pixels and the gate divides by the **5th** percentile,
so `p05` lands on the boundary of the band rather than inside it. Move one
notch in, to `p02` — still 229 pixels — and the same frame gives:

| divisor | ratio | gate's bar |
|---|---|---|
| p05 (the gate) | **1.67x** | > 2.0 → FAIL |
| p02 | **2.03x** | > 2.0 → pass |
| p01 / min | **2.03x** | > 2.0 → pass |
| mean of the dark band | 1.98x | marginal |

**Does the gate move when the thing under test is destroyed?** Barely. Repainting
the mass one flat colour with no vertical gradient — no undercroft shading at
all — scores **1.37x**. So the gate separates a correctly-shaded LBJ from a
deliberately flat one by 0.30, **and calls both of them red**. A gate whose pass
band contains neither the good build nor the broken one is not reporting on the
undercroft.

**It has never been green.** The assertion was written on 2026-07-31 (`88d24be`)
and its own comment records the calibration point — *"the travertine that
measures 0.42 here samples #f7ddaf in docs/shots"*. Tonight it measures 0.4376.
The travertine has not moved; the bar was set above what this geometry can
produce.

**Honest caveat.** 2.03x is a hair over 2.0. The right fix is not "divide by p02
and call it green" — it is to state the claim as something measurable (the dark
band's mean against the lit face, with a bar chosen from a measurement) and to
say plainly that this building clears "twice as dark" only just.

**Photographs.** `shots/reds/lbj-as-a-visitor-sees-it.png` (the gate's pose,
nothing hidden — the LBJ is there and reads as pale stone),
`shots/reds/lbj-isolated-as-the-gate-sees-it.png` (what the gate measures — note
that `gl.readPixels` reads the map canvas *before* the FX composite, which is
why it is darker than the site), and `shots/reds/lbj-flattened-control.png` (the
deliberately-broken arm, 1.37x).

---

### 4. `graphics` 26/27 — the test asserts a class the app owns

**Verdict: INSTRUMENT. Flaky. Correct version: GREEN. The slider behaviour it
claims to guard passed 9/9 in every rep.**

The assertion:

```js
check('slider is live while .flying but no pointer is down',
  tod.flyingOnly !== 'none' && tod.afterDrag !== 'none' && tod.stillFlying, ...)
```

The first two conjuncts are the real subject: the time-of-day panel must be
clickable while flying and dead only while a finger is down. The third asserts
that `document.body.classList.add('flying')` — written by the *test*, four lines
earlier — is still there at the end of the block.

It isn't the test's class. `js/controls.js` owns `.flying`, and the
`pointerdown` **that this very test dispatches** lands on the canvas handler at
`controls.js:1196`, which calls `markFlying()`, which arms a 4000 ms timer to
**remove** it (`controls.js:1398-1405`). If the two 60 ms waits in the block
stretch past four seconds — routine on a contended SwiftShader run — the class
is gone before it is read.

Reproduced deterministically. Nine repetitions of the exact block:

```
rep  stall   flyingOnly  duringDrag  afterDrag  stillFlying  verdict
  0       0   auto        none        auto       false        FAIL
  1       0   auto        none        auto       false        FAIL
  2..5    0   auto        none        auto       true         PASS
  S0..S2  4500ms  auto    none        auto       false        FAIL   (3/3)
```

`flyingOnly` is `auto` and `afterDrag` is `auto` in **all nine** — the slider is
live exactly when it should be. `duringDrag` is `none` in all nine — the
protection during a look-swipe holds. Only the test's own bookkeeping fails, and
injecting a 4.5 s main-thread stall makes it fail every time.

Both of my full `graphics.mjs` runs came back **27/27**. §155's 26/27 was one
reading on a machine with a sibling lane's browser on it.

---

### 5. `orbit-check` 3/4 — one instantaneous sample of a boolean that has seams

**Verdict: INSTRUMENT. Flaky. Correct version: GREEN. The orbit runs 110 degrees
without stopping.**

```
*FAIL  the camera circles the landmark
       bearing moved 39.5deg, easing false
```

The landmark orbit (`js/app.js:1979`) is a **chain** of 9000 ms `easeTo` legs of
40 degrees each, re-armed by `setTimeout(leg, ORBIT.legMs + 50)`. Between legs
there is a ~50 ms seam in which `map.isEasing()` is legitimately false.
`orbit-check` samples that boolean at exactly one instant, computed from
wall-clock `waitForTimeout`s that take no account of how long its own
`page.evaluate` round-trips take on a busy main thread. **39.5 degrees is one leg
exactly**, i.e. the sample landed on the seam.

The discriminator is an in-page sampler armed before the tap, so no CDP latency
can move the sample time. Thirty seconds after the tap:

```
t=389 ms   bearing -110.00   EASING
t=4350     bearing -105.58   EASING
t=9303     bearing  -85.52   EASING
t=15686    bearing  -57.26   EASING
t=22409    bearing  -31.60   EASING
t=29518    bearing    0.20   EASING
samples with easing FALSE: none      (29 of 29 samples EASING)
```

110 degrees of continuous orbit, no stall, no seam caught. At the gate's own
nominal sample times the assertion reads *swung 24.4 deg, easing true → PASS*.

Reading 2 of the real gate agrees: **4/4, "bearing moved 33.3deg, easing true"**.
The correct assertion is that the bearing keeps advancing, which is true
throughout.

---

### 6. `light-probe` 8/9 — a stopwatch on the page load, labelled as a precondition

**Verdict: INSTRUMENT, and the script says so in the assertion's own name.
Flaky. Correct version: GREEN.**

```js
check('ease starts before the probe window (test precondition)',
  tNow < 9500 && priorProbe === 0, `page t=${...}s, prior probe logs ${...}`);
```

`tNow` is `performance.now()` at the moment `isStyleLoaded()` first returns true.
The assertion is *"this machine finished loading 28 MB of city in under 9.5
seconds."* That is a statement about the Acer, not about the auto-detect probe.
When it fails, the three assertions that are actually about probe behaviour are
still evaluated against a window that has already closed.

It **passed 9/9 here** (57.4 s, run alone as `run.mjs` requires). §155 already
suspected this one — *"probably the ruler again"* — and it is.

---

## What this pass did NOT establish

1. **I did not fix anything.** Six diagnoses, no edits to any gate. The
   corrections implied above — count the Capitol's own sources; make
   `frames >= 5` a skip rather than a failure; measure the undercroft inside the
   undercroft; drop `stillFlying`; assert a moving bearing rather than an
   instantaneous `isEasing()`; drop or downgrade the load-time precondition —
   are all written down and none is applied.
2. **The other six of the twelve are untouched.** Five watchdog casualties
   (`movement`, `lookup-check`, `field-bleed`, `perf-budget`, `night-luma`) are
   still UNKNOWN, and `movement.mjs` is still the README's first gate and still
   unrunnable at the 300 s ceiling. `night-luma.mjs` may be a genuine hang. That
   is the next pass.
3. **`light-ae`'s and `orbit-check`'s and `light-probe`'s first-red dates are
   inferred, not recorded.** I can prove they are structurally old — the
   `frames >= 5` guard dates to 2026-07-30, the orbit leg chain to the feature
   commit — but no earlier run of any of the three is written down anywhere in
   this repo, so "red before tonight" is an inference for those three and a
   citation for the other three.
4. **I did not re-run any of the six under a *deliberately broken app*, except
   `arts-check`.** For the LBJ I flattened the shading and watched the gate move
   0.30 and stay red, which is the real discriminator. For the other five the
   evidence is of the other shape — the app was measured directly and found
   correct — which is weaker against the case where a gate is red for the right
   reason and my direct measurement is the thing that is wrong.
5. **The composited screenshot of the isolated LBJ reads darker than the
   flattened control**, and I did not chase why. It does not affect the verdict:
   the gate's number comes from `gl.readPixels` on the map canvas *before* the FX
   composite, and 0.4376 matches the calibration the file recorded when the
   assertion was written.
6. **Nothing here re-examines the `*-perf` family**, still excluded by name, and
   nothing here schedules the suite. §149 and §155 both said nothing runs it on a
   schedule; still true.

---
---

# The twelve reds — part two: the five watchdog casualties

**2026-08-16, acer lane, branch `acer/o4-reds`.** Part one read the six "real
assertion failures" and found all six were the ruler. This is the other five —
the ones §155 recorded as **UNKNOWN, not red**, because all five were killed at
`chrome.mjs`'s 300 s watchdog and nobody raised the ceiling.

Method: throwaway worktree off `origin/main` `f1ef012`, `python scripts/serve.py
8512`, `harness-drift.mjs` **PASS (29 scripts = 29 scripts, both documents)**
before anything else, and again at the end with the four new probes in the tree.
`suite-lint.mjs` **PASS, 147 scripts, 0 blocking findings**. Every gate ran with
`VERIFY_MAX_MS` raised from the environment — which works, because §155 already
moved `MAX_RUN_MS` out of the module-level `const` and into `launch()`, so the
`walk.mjs` shape (a ceiling frozen at import and unraisable through ESM
hoisting) does not exist in any of these five; none of them reads
`process.env.VERIFY_MAX_MS` itself. Chrome/node process counts are quoted with
every timing.

---

## The finding, in one line

**None of the five is hung. All five finish, and all five are red.** Four of the
five reds are the instrument; **one is real, was already known, and had gone
quiet.**

| gate | ran in | verdict | the red is |
|---|---|---|---|
| `movement` | 436 / 470 / 457 s | 13/14, 14/14, 12/14 | **the ruler** — its top two assertions are a ±10 % coin flip |
| `night-luma` | 830 s | 0/4 poses, exit 1 | **the ruler** — reads 0 trees on a frame holding 31,723 |
| `lookup-check` | 448 s | 8/9, exit 1 | **the ruler** — all three altitude cases run at the first one's |
| `perf-budget` | 404 s | 5 of 6 over budget, exit 1 | **REAL, and known** — QUEUE Y7 and Y15, red on purpose |
| `field-bleed` | >= 25 min, killed at 6 of 18 poses | 1 red in 6 | **the ruler** — a mis-set expectation, photographed |

**Not one of them is a hang, and `night-luma` — the one §155 singled out as
"may be a genuine hang" — is the clearest case of the opposite.** It runs its
retry ladder to the end and exits 1 in 830 s. The retries are not it failing to
converge; they are it converging perfectly (drift **0.0000**) and then being
told it has not.

**And the ceiling was never these gates' fault either.** Five scripts that each
need 400–2900 s were being run at 300 s. That number is `run.mjs`'s `--timeout`
default; nothing about these five was ever measured against it.

---

## 7. `movement` — the README's first gate, and its headline number is a coin flip

**Verdict: SLOW BUT HONEST (7–8 minutes). Its two speed assertions are the
INSTRUMENT. Correct version: GREEN.**

It runs. Three reps, with the machine recorded beside each:

```
rep 1   436 s   13/14   chrome 21, CPU 97 %   east/north 0.905          FAIL
rep 2   470 s   14/14   chrome 31 -> 22       (both speed assertions pass)
rep 3   457 s   12/14   chrome 22 -> 23       east/north 1.092          FAIL
                                              diagonal/cardinal 1.116   FAIL
```

**0.905 and 1.092 are the same assertion failing in opposite directions.** A
directional asymmetry in the movement code cannot change sign. That alone
settles it, and it reproduces §144's interleaved table, which recorded
`movement.mjs` swinging 11/14 -> 14/14 on `origin/main` itself with this
assertion named as the first to go.

**The discriminator, and the actual defect in the ruler.**
`scripts/verify/_o4-eastnorth.mjs` measures the identical quantity but paces the
ramp and the measurement window by the camera's own **sim time** and samples
`|vel|` every frame, all inside one `page.evaluate` so no CDP round trip can land
mid-measurement. Eight legs, interleaved and counterbalanced:

```
median displacement/s   north 56.65   east 56.65   east/north 1.000
median |vel| mean       north 56.65   east 56.65   east/north 1.000
spread                  north 56.65-56.65   east 56.65-56.65
```

**Zero spread, to five significant figures, in both directions.** The movement
code is exactly symmetric.

**Why `movement.mjs` disagrees.** `speedOnce()` honours the README's rule for its
*denominator* — `dtSim = __fly.simTime()` — and breaks it for its *window
boundaries*:

```js
for (const k of keys) await page.keyboard.down(k);
await page.waitForTimeout(1500);           // "spend the acceleration ramp first"
const before = await page.evaluate(...);
await page.waitForTimeout(ms);             // 2500 ms — WALL CLOCK
```

`TAU_ACCEL` is 0.2 s of **sim** time and `simTime` accumulates `min(delta, 64)`
per frame, so at 4 fps a 1500 ms wall-clock ramp is six frames — 0.38 s of sim —
and the camera is still accelerating when the window opens. The signature is in
the gate's own output: terminal speed is 56.65 m/s and **every reading
`movement.mjs` produced is below it** — 55.6 and 50.3 in rep 1, 49.1 and 53.6 in
rep 3. Each leg captures a different fraction of the ramp, and the assertion is
the ratio of two shortfalls.

**Two hypotheses ruled out rather than argued away.**

- *The soft data fence.* `movement.mjs`'s own header records the sibling case —
  "the diagonal legs ran into the soft data fence, which crushed `vel.n`". Read
  from the app at the gate's own start pose: `FENCE_SOFT` is 250 m and the pose
  is **W 4532 / E 4225 / S 5332 / N 3508 m** from its own fence edges, against a
  224 m leg. It cannot bite.
- *Collision.* `loss` — displacement/s against mean `|vel|` — was **0.00 % on all
  eight legs.** Nothing is eating the velocity between the controller and the
  ground.

**Two smaller things, since this is the first gate README lists.**
`window.__reset` (`movement.mjs:58`) polls `!driving` every 120 ms **with no
deadline** — the one genuine hang shape in the file, unfired in three reps but
still there. And `suite-lint.mjs` flags `movement.mjs` as never calling
`window.cancelGraphicsAutoDetect()`, so the 11 s probe lands inside a run that
lasts seven minutes. Neither explains the swing — the probe was cancelled in
`_o4-eastnorth` and the ratio was still 1.000 — and both are worth fixing.

---

## 8. `night-luma` — not a hang: a query that has read zero trees since the trees were tiled

**Verdict: SLOW BY CONSEQUENCE (830 s), and the whole red is ONE unsatisfiable
clause. INSTRUMENT. Correct version: GREEN.**

This is the one §155 flagged as *"may be a genuine hang"*. It is not. It ran its
full retry ladder — two retries at each of four poses — printed a complete
report and exited 1 in **830 s**, on a quiet machine (22 chrome, 1 node,
unchanged start to finish).

Every pose reported the same thing:

```
*** NEVER SETTLED (0 trees, 4222 buildings, drift 0) ***
*** NEVER SETTLED (0 trees, 7033 buildings, drift 0) ***
*** NEVER SETTLED (0 trees, 5644 buildings, drift 0) ***
*** NEVER SETTLED (0 trees, 7033 buildings, drift 0) ***
```

Read the numbers rather than the verdict, exactly as the README says to for
`coplanar.mjs`. The settle predicate is

```js
ok = drift !== null && trees > 300 && bld > 300
```

- `drift 0` — `S.stable()` returned **0.0000**, against a bar of 0.05. The frame
  was not merely settled, it was stable across a strided probe of all 576,000
  pixels.
- `bld 4222–7033` — fourteen to twenty-three times its bar.
- `trees 0`.

**The entire red, and the eight extra full-pose settles the retry ladder then
runs, come from `trees > 300` alone.**

**The cause, measured.** `scripts/verify/_o4-treecount.mjs`, at `night-luma`'s own
`core` pose, on `_harness.html`, same settle:

```
pmtiles archives present: true
austin-trees source spec: {"type":"vector","url":"pmtiles://data/tiles/trees.pmtiles","maxzoom":16}

source                 type      source-layer   loaded   qSF(no opts)   qSF(with layer)
austin-buildings      geojson   null           true             4222   (none declared)
austin-ground         geojson   null           true            21521   (none declared)
austin-trees          vector    trees          true                0             31723
austin-capitol-ground geojson   null           true             1897   (none declared)
austin-trees-capitol  geojson   null           true              464   (none declared)
```

**31,723 tree features are in the tiles under that camera. `night-luma` reads
0.** `js/app.js:1376` builds `austin-trees` from `window.tileSource('trees')` — a
**vector** source over pmtiles, to keep the 9.13 MB `data/trees.geojson` off the
wire — falling back to GeoJSON only when the archives are missing.
`map.querySourceFeatures(id)` returns `[]` for a vector source unless it is given
the `sourceLayer`; for a GeoJSON source that layer is implicit, which is why
`austin-buildings` still answers. `night-luma` never passes one, so it has read 0
trees at every pose since the tree layer was tiled, whatever is on screen.

**This is the same shape as `capitol-merge` (part one, #1): a checker keyed on a
source shape the app stopped using.** That is now two of the twelve, found
independently, and it is the fifth guard in this repo shown to be blind to the
thing it guards. Note the neighbouring wait at `night-luma.mjs:117` has the same
blind spot in the opposite direction — `!m.getSource(s) || m.isSourceLoaded(s)`
means a *missing* source passes.

**The correction is one argument** — `querySourceFeatures('austin-trees',
{ sourceLayer: 'trees' })`, read off the layer rather than typed — and it takes
the 830 s down with it, because the retries are the cost.

**And the numbers underneath were fine.** With the settle clause disregarded, all
four poses report a night histogram of the shape the file argues for: `dark`
83–87 % of frame at p50 32–35, `lit` 4–6 % with p99 148–247, frame mean
0.1471–0.1586 normalised against the AE ceiling of 0.1585. Nothing here suggests
the night is broken. I did **not** re-run the assertions with the clause
corrected, so that is an observation about the printed table, not a pass.

---

## 9. `lookup-check` — the fix in its own comment has come back

**Verdict: SLOW BUT HONEST (448 s). The red is the INSTRUMENT — a deadline short
by a factor of two — and it is a regression of a defect this file documents as
already fixed.**

448 s, exit 1, 8/9. The failing line:

```
*FAIL  the reachable pitch falls with altitude, as the zoom floor requires
       120 m -> 87.36 deg, 120 m -> 87.36 deg
```

Read the *passing* lines and it is worse than one red:

```
 PASS  a drag reaches the ceiling low down       seeded 120 m, ended 120 m
 PASS  the cap rises monotonically               120m:87.36  120m:87.36  120m:87.36
 PASS  looking up from 880 m does not move       altitude 150 -> 150
```

`lookUpFrom(450)` and `lookUpFrom(880)` both produced an eye at **120 m**, and all
three drift cases produced **150 m**. Six of the nine assertions are being
evaluated three times at one altitude. `lookup-check.mjs:88` describes this exact
defect and claims it fixed:

> "The first cut re-seeded straight after a drag and every case silently ran at
> the FIRST case's altitude — all three reported 120 m."

**The fix is a deadline, not a wait.** `settled()` polls the eye but gives up at a
hard `timeoutMs = 8500` whether or not the camera stopped, and the in-page
`for (i < 40 && driving) sleep 100` adds another 4 s ceiling; both then seed
regardless. `scripts/verify/_o4-seedlag.mjs` runs the identical look gesture and
seeds two ways:

```
ARM A — seed at lookup-check's own deadlines (8500 + 4000 ms)
alt want   driving at seed   alt held   pitch    zoom want -> got
     120             true        127    87.21      17.438 -> 14.054
     450             true        127    87.21      15.532 -> 14.051
     880             true        127    87.21      14.564 -> 14.024

ARM B — seed only after `driving` has genuinely gone false
alt want   driving tail ms   alt held   pitch    zoom want -> got
     120            25302        120       60      17.438 -> 17.438
     450            24285        450       60      15.532 -> 15.532
     880            26835        880       60      14.564 -> 14.564
```

**The controller's ownership tail after a two-pass look drag is 24–27 seconds on
this machine. The gate budgets 12.5.** `driving` is still `true` at every one of
ARM A's three seeds, so every `jumpTo` is overwritten on the next frame — the
README's own trap, in the file whose comment says it was closed. Wait properly
and the placement is exact: 120 -> 120, 450 -> 450, 880 -> 880, requested zoom
equal to delivered zoom to three decimals, pitch 60 as asked.

**`ZOOM_MIN` is not the cause, and I checked rather than assumed.** It is 14, and
ARM B reaches 14.564 at 880 m without touching it. ARM A's `14.05` is not a
clamp; it is the camera still sitting in its post-drag pose.

**So the app is fine and the gate is not measuring what it prints.** The correct
fix is the one the file already knows: wait for `!driving`, with the fixed
duration as a floor and not as a ceiling — and fail loudly when the eye does not
land where it was put, rather than printing `seeded 120 m` for a request of 880.

---

## 10. `perf-budget` — the one that is really red, and it had gone quiet

**Verdict: SLOW BUT HONEST (404 s) and GENUINELY RED. This is not the instrument.
It is QUEUE Y7 and Y15, and it is red on purpose.**

404 s — over the ceiling by 104 s, and unavoidable: `REPS` defaults to
`max(2, 3)` and `MIN_VALID` is 2, so the gate cannot give an honest answer in
fewer than two reps of two phases, each on its own page load with a walk watchdog
of 110 s. **It has never been able to fit inside 300 s.**

All six phases valid, each with the machine recorded beside it:

```
  rep 1 cruise  maxMs  25.9   tickMs  8.342  1503 m  frames  285 | pre chrome 19 cpu  6% | post cpu  5%
  rep 1 walk    maxMs  37.5*  tickMs  4.963   300 m  frames 4711 | pre chrome 19 cpu 30% | post cpu 18%
  rep 2 walk    maxMs  64.2*  tickMs  5.031   300 m  frames 4661 | pre chrome 20 cpu 11% | post cpu 64%
  rep 2 cruise  maxMs  18.4   tickMs 10.011  1502 m  frames  223 | pre chrome 26 cpu 21% | post cpu 39%
  rep 3 cruise  maxMs  53.9*  tickMs  8.647  1502 m  frames  260 | pre chrome 19 cpu  8% | post cpu 43%
  rep 3 walk    maxMs  40.1*  tickMs  4.981   300 m  frames 4678 | pre chrome 26 cpu 34% | post cpu 29%

  valid reps: cruise 3/3, walk 3/3

  FAIL  G1   controls tick at cruise             8.342 ms vs 1.5 ms
  FAIL  G2   controls tick at 1.7 m              4.963 ms vs 2.5 ms
  FAIL  G3   outer-ring scan worst case (Y7)    18.40 ms vs 8 ms
  FAIL  G4   trunk field scan worst case (Y15)  37.50 ms vs 8 ms
  FAIL  G5a  outer scan duty cycle               1.77 % vs 0.53 %
   ok   G5b  trunk scan duty cycle               0.42 % vs 0.53 %
```

**Why this one is not the ruler**, as the four things that would make it one, each
answered inside the run:

1. *A short run reads as a cheap one.* Every cruise rep drove 1502–1503 m against
   an 800 m minimum, and every walk drove the full 300 m at **alt 1.7 for every
   frame**. `valid reps: 3/3, 3/3`.
2. *A cumulative maximum is not attributable.* Each phase gets its own page load,
   and the run reports `a phase SET the worst case: outer true, trunk true` — the
   maxima grew **during** the driving, not at boot.
3. *A mean measures the machine.* The reported figure is the **minimum** across
   three counterbalanced reps, so contention can only make the number look worse,
   and the minimum is the least-contaminated estimate of the code's own cost.
4. *The bar might be unreachable.* §143 already watched this gate in both
   directions on the merged tree — red on the real overrun, and green on the same
   build with `PB_OUTER_MS=400 PB_TICK_CRUISE=45 PB_DUTY_PCT=30`. It is not stuck.

**It has been red since it was written** (`f78860c`, *"A gate for the frame
budget: the ring is over it on every reading"*), and §143 recorded G1 19.975 /
G3 43.30 / G5a 2.06 % on `origin/main`. So this is a *fourth* dated red among the
twelve, and the fifth of the twelve shown to have been red before §155.

**One thing here is new, and it is good news.** §143 recorded G2, G4 and G5b as
`INVALID` — the walk phase could not be measured at all, three passes in a row —
and §148 recorded that the walker rewrite of §145 *"was NOT re-run end to end"*.
It has been now: **three valid walks, 300 m each, every frame under 12 m, and
G4 = 37.5 ms is QUEUE Y15's trunk-scan cost measured from a real sustained walk
in a gate run for the first time.** G5b at 0.42 % is the only assertion in the
file that passes, which says the throttle works and the per-instalment cost does
not.

**§158B landed on `origin/main` while this pass was running, from the opposite
direction, and it agrees.** It patched `querySourceFeatures` and drove
`perf-budget`'s own 1,500 m cruise: G3's worst scan **is a single query call** —
100 %, 100 %, 100 %, 53 % across four reps — and at its cheapest counterbalanced
minimum the query alone is 6.10 ms of the 8 ms budget. This document establishes
that G3 is a real red rather than the ruler; `docs/perf/y7-outer-scan.md`
establishes which half of the scan owns it. My G3 minimum of 18.40 ms sits below
its 38–86 ms range because mine is a min-across-three taken on a quieter slot —
the attribution is theirs and I have not re-derived it.

**Two instrument notes that do not change the verdict.** `perf-budget` is **not in
`run.mjs`'s `SERIAL_ONLY` set** — that list holds `perf`, `perf2`, `perf3` and
matches on the exact script name, so the one gate in this suite whose entire
subject is milliseconds runs concurrently with up to three other browsers.
`movement`, `lookup-check`, `field-bleed` and `night-luma` are all outside it
too. And the CPU readings above swing 5 % -> 64 % **within a single rep**, which
is why the min-across-reps rule exists and why every number in this document
carries its process count.

---

## 11. `field-bleed` — the red is a mis-set expectation, and here is the picture

**Verdict: FAR OVER THE CEILING (>= 25 min; killed at 6 of 18 poses) and its one
red is the INSTRUMENT. Photographed.**

Killed at my own 1500 s ceiling having completed six poses:

```
PASS  day outside-north       pitch 79   field pixels    0            [126.6 s]
*FAIL day outside-north-70    pitch 70   field pixels 2986 (0.29%)    [147.7 s]
      mean rgb 121,123,63   box 594,369,685,405
PASS  day outside-northeast   pitch 76   field pixels    0            [272.1 s]
PASS  day outside-east        pitch 79   field pixels    0            [161.2 s]
PASS  day outside-south       pitch 79   field pixels    0            [118.0 s]
PASS  day outside-west        pitch 79   field pixels    0            [130.5 s]
```

**A single pose costs 118–272 s. The 300 s ceiling buys this gate two of its
eighteen.** Six screenshots at 1280x800 on SwiftShader plus three pure-JS PNG
inflates is the cost; nine day poses and nine night poses is about 48 minutes.

**The red looked like the worst case this pass could find.** `js/app.js:544`
records the original raster defect as *"3318 px at pitch 79, box
581,381-687,422"* — and here is 2986 px at box 594,369-685,405, the same band of
the frame, in the pose one notch below the one that was fixed. A defect hiding
behind a timeout is exactly what the brief said to treat as the most important
thing in this pass.

**It is not that. Look at it.** `scripts/verify/_o4-fieldframe.mjs` reproduces the
pose alone — 2986 px, identical box, identical mean rgb, so this is the same
measurement and not a different one — and paints field-bleed's own mask magenta:

- `shots/reds/field-bleed-70-plain.png` — what a visitor sees
- `shots/reds/field-bleed-70-magenta.png` — every pixel the turf layer painted

**The magenta is inside the bowl.** It is the far half of the playing field, seen
over the near rim, with the near grandstand's top edge cutting cleanly across
below it and the seating deck visible around it. Nothing is painting on the
outside face of the north wall. In the plain frame the turf is green with its
yard lines, correctly clipped by the rim.

**And field-bleed's own arithmetic says so, once it is applied to the right
point.** The header derives its expectations from the sight line to the FIELD
CENTRE:

```
pitch 70   eye 1093 m out, line is 49 m up at the rim   BLOCKED
```

At the measured altitude of 398.4 m the eye is 398.4 x tan 70 = 1094.6 m north of
centre. Using the header's own rim figures — 63 m tall, 135 m from centre — the
line to the **centre** is at 398.4 x 135/1094.6 = **49.1 m** at the rim, blocked,
exactly as it says. But the field is 123 m long, and the line to its **far edge**,
61.5 m beyond centre, is at 398.4 x (1 - 959.6/1156.1) = **67.7 m** at the same
rim — it **clears by 4.7 m**. The formula was applied to one point and generalised
to the whole field, so the pose was filed as `'zero'` when part of it is
legitimately visible.

**The header already made this mistake once, one notch down**, and says so: *"So
62 is NOT a bleed case and an earlier version of this file wrongly called it
one."* `outside-north-70` is the same error at 70. The correction is to move it to
`'some'`, or better, to state the claim as something the geometry can decide for
every pose — no turf outside the near rim's silhouette — rather than as a
hand-computed per-pose expectation.

(The rim's 63 m height and 135 m offset are the header's numbers, not ones I
measured, so the exact break-even pitch is theirs. The picture does not depend on
them.)

---

## What this pass did NOT establish

1. **`field-bleed`'s other twelve poses are unrun.** Three day poses
   (`into-bowl-62`, `over-rim`, `nadir` — all three `'some'` controls) and **all
   nine night poses** were never reached. The night half of this gate has not been
   seen in this pass at all, and the three `'some'` poses are the controls that
   would catch a "fix" that simply stops drawing the field. I am claiming the ONE
   red I saw is the instrument; I am **not** claiming the gate is green.
2. **I fixed nothing.** Five diagnoses, four new probe scripts, no edit to any
   gate. The corrections implied — pace `movement`'s ramp and window by sim time;
   pass `night-luma` a `sourceLayer`; make `lookup-check`'s settle a wait rather
   than a deadline; move `field-bleed`'s pitch-70 pose to `'some'`; put
   `perf-budget` and the other four into `SERIAL_ONLY`; raise the four ceilings
   that need raising — are all written down and none is applied.
3. **`night-luma`'s numbers were read, not asserted.** I disregarded the settle
   clause to read the histogram and it looks right, but I did not re-run the three
   per-pose assertions with the clause corrected, so "night-luma would be green"
   is an inference about one blocking clause, not a measured pass.
4. **`movement`'s diagonal assertion is diagnosed by analogy.** I measured north
   and east at 1.000 with zero spread; I did **not** run a W+D leg through
   `_o4-eastnorth`. `diagonal/cardinal` failed once at 1.116 and passed twice, and
   its mechanism is identical, but that is reasoning where east/north is
   measurement.
5. **Nothing was run against a deliberately broken app.** The evidence throughout
   is of the weaker shape — the app was measured directly and found correct — which
   does not cover the case where a gate is red for the right reason and my direct
   measurement is the thing that is wrong. `perf-budget` is the exception, and only
   because §143 had already watched it go both ways.
6. **The ceilings these five actually need are single measurements, taken on a
   machine with two other lanes on it.** 436–470 s for `movement`, 830 s for
   `night-luma`, 448 s for `lookup-check`, 404 s for `perf-budget`, and >= 1500 s —
   really about 2900 s — for `field-bleed`. Anyone setting a per-script ceiling
   should take headroom over these, not adopt them.
7. **One thing found in passing and not chased.** `suite-lint.mjs` run from the
   repo root prints `suite-lint: 0 scripts checked` and then **PASS**; from
   `scripts/verify/` it checks 147. That is the same shape as everything else in
   this document, in the tool written to catch it. (`harness-drift.mjs` is the
   mirror image — it must be run from the root, per §147.) Neither is mine to fix
   and both are one line.

---
---

# The twelve reds — part three: all twelve applied, and the one the diagnosis got wrong

**2026-08-16, acer lane, branch `acer/o5-reds`.** Parts one and two diagnosed the
twelve and fixed nothing — both said so in their own "did not establish" lists.
**This part applies every correction they wrote down.** It also fixes QUEUE Y20,
the one item in this whole set that a visitor could actually see.

Method: throwaway worktree off `origin/main` `9ef34a1`, `python scripts/serve.py
8513`, `harness-drift.mjs` **PASS (29 = 29)** before any pixel and again after
every edit, `suite-lint.mjs` **PASS, 0 blocking**. Every gate below was run after
its fix, and every gate that has a break mode was watched go RED.

---

## The finding, in one line

**Parts one and two were right about eleven of the twelve and wrong about one
line inside their own evidence.** The eleven instrument fixes all landed and all
went green. And Y20 — carried for weeks as "the DISC switches body in one frame"
— was never about the disc.

---

## Y20: the diagnosis named the wrong painter, and the ramps prove it

`js/sky.js`'s `const useMoon = !B.sunUp && B.moon.elev > -2` is a real
single-frame switch, and every previous pass blamed the disc it selects. Read
the disc's own visibility at the notch where the switch fires:

```
  q75  p=0.58594   sunElev  -2.59   moonElev  -2.62   visSun 0.000   visMoon 0.000
  q76  p=0.59375   sunElev  -3.38   moonElev  -1.88   visSun 0.000   visMoon 0.020
```

**Both ramps are at zero.** There is no disc on screen to teleport. What the
83 levels of blue actually were: the SUN's two horizon washes were painted in
`haloCol`, the switched colour, while the MOON's were painted in the constant
`moonHalo`. So the western afterglow — same position, same alpha — was repainted
warm-to-cool the instant the moon crossed −2°.

That is the twilight rewrite half-applied. It gave the two washes independent
*schedules*; it left their *colours* on the boolean. The fix finishes it, and it
reuses the file's own continuous weights rather than adding a third schedule:

```js
const sunHalo = sunColour(B.sun.elev);                       // never switched
const moonMix = wMoon / Math.max(1e-6, wSun + wMoon);        // continuous, for the clouds
drawGlow(hzSun,  ..., glowASun,  sunHalo,  WIDE);            // each body, its own colour
drawGlow(hzMoon, ..., glowAMoon, moonHalo, WIDE);
```

**The A/B, both arms in one build** (`scripts/verify/y20-handover.mjs`, driven by
`SKY_TUNE.HANDOVER.ON`, which is in `hourMemo`'s cache key so the arms cannot
share a memo):

| arm | 75/128 → 76/128 | worst channel |
|---|---|---|
| `HANDOVER.ON = false` | R 35, G 33, B 83 | **83** |
| `HANDOVER.ON = true` | R 6, G 6, B 2 | **6** |

**The first run of that A/B read 6 on both arms and caught me shipping an OFF
arm that already carried half the fix.** That is the exact failure this repo has
recorded before, and it is the reason the flag now gates the wash colour in one
place and the probe echoes the flag beside every reading.

`dusk.mjs`'s `KNOWN` list is now empty and it passes without it — **worst step 8
across 60 transitions** against `MAX_STEP` 26 — while `dusk.mjs --break` still
goes red at 42. Frames: `shots/reds/y20-{before,after}-q{75,76}.png`.

---

## The eleven, applied

| gate | before | the correction | after |
|---|---|---|---|
| `capitol-merge` | 0 trees / "merge never ran" | reads `window.__capitolMerge`; counts the Capitol's OWN sources; fails loudly on an unrecognised shape | **4/4** (`--selftest` 0/4) |
| `night-luma` | 0 of 4 poses, 830 s | `querySourceFeatures` given a `sourceLayer`, read off the layer | **12/12**, 36,364 trees |
| `graphics` | 26/27 | `stillFlying` reported, not asserted | **27/27** |
| `orbit-check` | 3/4 | 13 in-page samples of a moving bearing | **4/4**, 54.7°, easing 100 % |
| `light-ae` | 6–7/8 | meter paced by FRAMES; lift bar relative to the spawn pose | **8/8**, spread 0.0000 ×4 |
| `light-probe` | 8/9 | the load-time stopwatch split out of the precondition | see the health table |
| `arts-check` | 27/28 | LBJ ratio restated as undercroft-mean vs lit face, bar 1.70 chosen from 1.37 (broken) and 1.98 (good) | see the health table |
| `lookup-check` | 8/9 | the 8.5 s deadline made a 45 s WAIT; a new assertion that the seed landed | see the health table |
| `movement` | 12–14/14 | ramp AND window paced by sim time, in one `page.evaluate`; `__reset` given a deadline | see the health table |
| `field-bleed` | 1 red in 6 | `outside-north-70` corrected to `'some'`; `--only`/`--times` slicing with an honest partial verdict | see the health table |
| `perf-budget` | 5 of 6 over | **untouched — it is a real budget.** Ceiling 900 s, added to `SERIAL_ONLY` | still red, correctly |

---

## One line of part one's own evidence was the instrument it was about to find

Part one's table recorded `austin-trees` at **0** features inside the Capitol
box, offered as proof that the Capitol had moved to its own sources. It had —
but that particular zero was not the proof. Counted **with** a `sourceLayer`,
`austin-trees` holds **3339** features in that box. Part one measured it the same
way `night-luma` did, one section before diagnosing exactly that bug in
`night-luma`. The verdict on `capitol-merge` was still right, for the other three
reasons it gave.

---

## What part three did NOT establish

1. **`field-bleed`'s nine night poses are still unrun**, and two of its three
   `'some'` day controls with them. The `outside-north-70` correction rests on
   §159's photograph and on the geometry, not on a full green run.
2. **`perf-budget` was not run to completion here.** Its raised ceiling and its
   `SERIAL_ONLY` entry are `run.mjs` changes verified by reading and by the suite
   run, not by watching a 900 s `perf-budget` finish inside the runner.
3. **Two readings, not many.** Each fixed gate was watched pass and, where it has
   one, watched fail through its break mode. None of these assertions is a timing
   claim any more — that was most of the point — but two readings is still two.
4. **Y20 was judged at one pose**, `dusk.mjs`'s, plus that file's own 60-step
   sweep. Other bearings are unphotographed, and the clouds' cross-fade is argued
   from the continuity of `wSun`/`wMoon` rather than measured pixel by pixel.
5. **Parts one and two were not re-derived.** The `austin-trees` error above
   surfaced because the rewrite happened to measure it; nothing else was audited.
