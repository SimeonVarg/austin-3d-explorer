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
