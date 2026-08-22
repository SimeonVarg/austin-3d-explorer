# The second front — frame cost, measured

Companion to `docs/second-front-verdict.md`, which shipped all four fronts
without re-timing cost: *"Frame/render cost of the combined build was not
independently re-timed in this pass."* This is that measurement, taken on the
actual merged build (`acer/second-front-ship`, all four fronts +
`acer/f2-atlas-instrumentation` combined), not on any branch in isolation.

## What could possibly cost anything, and what could not

Every one of the five ports (`js/drag.js`, `js/tower.js`, `js/moody.js`,
`js/arts.js`, `js/places.js`) calls `window.PatternLowpass.blurWrap` from
inside its own `tileData()`-equivalent, which runs at **init and on a
time-of-day tick only** — never from the render loop (confirmed by reading
every call site, not just cited: `js/tower.js:747,1552`, and the equivalent
two-call-site shape in each of the other four files). `blurWrap` never calls
`map.updateImage`/`addImage` itself, so `js/facades.js`'s `ATLAS.RELEASE`
staleness tracker — the 46%→2–3% main-thread win this repo already fought for
— is untouched by construction. **Flying/cruise frame rate cannot be affected
by any of this**, and was not independently re-timed for the same reason
`docs/shimmer-cost.md` gave for `shim-lowpass` itself: there is no
per-frame call site to time.

The one place a per-family box blur COULD cost something is the repaint call
itself — `updateFacades`, `applyDragColors`, `applyTowerColors`,
`applyMoodyColors`, `applyArtsColors`, `applyPlacesColors` — so that is what
this measures.

## Method

`scripts/verify/second-front-atlas-perf.mjs` (new), modeled on
`acer/f2-tower`'s own `tower-atlas-perf.mjs`, generalized to all six
registries in one page load: radius forced to 0 (no blur, every family) vs
each family's own actual shipped radius (not a single value broadcast to
every family — an earlier draft of this script had exactly that bug, caught
before shipping by comparing against `tower-atlas-perf.mjs`'s own
already-published number and finding a 6-9% discrepancy explained by
`js/facades.js`'s and `js/moody.js`'s non-uniform per-family radii; fixed and
re-run, see below), interleaved and counterbalanced (alternating which arm
goes first each rep, per CLAUDE.md rule 10 / this repo's own README), 12 reps,
minimum reported. Headless+SwiftShader (this script's own default, unlike a
render-fps script) — the atlas draw is plain Canvas2D/JS, not WebGL, so the
GL backend does not bear on a `performance.now()` delta around a JS function
call. Machine load: heavy throughout (23-26 sibling `chrome.exe` via
`tasklist`), which inflates wall-clock but not the min-of-interleaved-reps
comparison.

## Results

| registry | off, radius=0 (min/med) | on, shipped (min/med) | delta (min) |
|---|---|---|---|
| facade | 76.80 / 119.20 ms | 218.30 / 304.50 ms | +141.50 ms |
| drag | 2.90 / 4.40 ms | 18.50 / 25.00 ms | +15.60 ms |
| tower | 17.00 / 18.90 ms | 101.70 / 109.80 ms | +84.70 ms |
| moody | 1.50 / 2.90 ms | 12.40 / 14.60 ms | +10.90 ms |
| arts | 0.50 / 1.20 ms | 1.90 / 2.40 ms | +1.40 ms |
| places | 0.20 / 0.80 ms | 1.20 / 2.00 ms | +1.00 ms |

**Cross-check**: `tower`'s delta here (+84.70ms) reproduces `acer/f2-tower`'s
own commit-message number (+88.4ms, 16.9→105.3ms) to within ~4ms/5% on an
independent run, on the fully-merged build rather than the tower branch
alone — no cross-front inflation from combining with drag/moody/arts/places.

## Reading the table honestly

**The `facade` row is NOT new cost from this PR.** `js/facades.js`'s own
`SOFTEN.RADIUS` (`lo:3, mr:3, mh:3, tr:3, tg:2, dk:2, st:1`) is unchanged by
this PR — it is the value `shim-lowpass` (PR #214) already shipped three weeks
ago. This PR only moved the blur math into a shared file
(`js/pattern-lowpass.js`); it did not touch what facades.js asks that math to
do. The 76.8→218.3ms delta is what `shim-lowpass` already costs today on
`main`, quoted here as the reference point the five new fronts are measured
against, not as a regression this PR introduces.

**The real cost this PR adds** is the five new-port rows, because these five
files had **zero** blur before today — their "off" number is what they
already cost on `main`, unconditionally, and their "on" number is the new
reality:

    drag   +15.6 ms
    tower  +84.7 ms   <- the file Simeon named
    moody  +10.9 ms
    arts    +1.4 ms
    places  +1.0 ms
    -----------------
    total ~113.6 ms added, across all five, on a repaint

**When this fires**: once at page load (`registerPatterns`/equivalent), and
once per time-of-day step thereafter. `js/app.js`'s own time-of-day path is
already quantized (1/128 steps, per `scripts/verify/README.md`'s debug-hooks
section), so a single slow visible frame during ordinary use — dragging the
time slider, or `?sliderdemo=1`'s scripted sweep to night — would show as one
~113ms hitch riding on top of `facade`'s own already-larger ~141ms, not a
steady-state cost. This was not independently confirmed by watching
`?sliderdemo=1` run and looking for a visible stutter — see below.

**`tower` is the largest of the five new ports, and its own commit already
explains why**: it has no `SCALE`/decimation tiers (unlike `facades.js`),
so every one of ~66 registered pattern images gets a full un-decimated
64×64 blur, and its prior radius was 0 — a first-time addition, not a
strengthening of an existing knob, so it reads as a 100% increase rather than
an incremental one.

## What this did NOT establish

- Whether `?sliderdemo=1`'s scripted day→night sweep shows a VISIBLE stutter
  at the moment these repaints fire — the number above says a hitch of this
  size is structurally possible on a slow tick, not that one was seen.
- Actual flying/cruise fps was not independently re-timed on the merged
  build — the structural argument (no per-frame call site, `ATLAS.RELEASE`
  untouched) is the same one `docs/shimmer-cost.md` and every individual
  front's own commit already made for the identical reason, not re-litigated
  with a fresh fps run here.
- Whether the five repaint functions could be made cheaper (batching,
  caching drawn tiles the way `js/facades.js`'s own `rawTile` does across its
  two tiers) — out of scope for a ship decision already made on the
  crawl-percentage evidence; flagged for whoever next touches these files if
  the ~113ms combined repaint cost ever becomes the binding constraint.
