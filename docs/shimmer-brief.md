# The window shimmer — what is established, so nobody re-derives it

**Status: PARTIALLY MITIGATED, updated 2026-08-22 evening. Both fronts are
now shipped: `acer/shim-lowpass` (PR #214, the core atlas —
`buildings-3d`/`wc-wall`) and the second front (PR #215 —
`js/tower.js`/`js/drag.js`/`js/moody.js`/`js/arts.js`/`js/places.js`, the
five files the first front structurally could not reach). The defect is
REDUCED at every pose measured on every one of these files, and windows
still visibly crawl after both fixes — the mechanism is continuous
minification aliasing (`docs/shimmer-mechanism.md`) and a band-limit reduces
its density, it does not remove it. Full detail: `docs/shimmer-mechanism.md`
(root cause, confirmed), `docs/shimmer-verdict.md` +
`docs/shimmer-cost.md` (round one: the three candidates tried, one shipped),
`docs/second-front-verdict.md` + `docs/second-front-cost.md` (round two: all
four fronts shipped, frame cost re-timed on the merged build).**

Reported 2026-08-21, after the AWS reel was recorded:

> *"its a horrible motion glitch ... same motion glitch from a few weeks ago"*
> *"the bottom of the tower is having the same window glitching problem"*

## 1. It is invisible in a still frame. Do not judge it from a screenshot.

Three separate wrong answers were given to Simeon on this defect in one evening,
all of them from reading stills:

* *"the Tower base looks the same before and after my change"* — true, and
  irrelevant.
* *"there is no speckle at the poses your shots actually use"* — from stills,
  and **wrong**.
* A speckled patch WAS found in a still at z17.6 and chased for an hour. It is a
  real second artefact but it is **not** what he is reporting.

`scripts/verify/coplanar.mjs` says it in its own header: *"it is invisible in a
still frame taken at one pose."* Read that file and `scripts/verify/zfight.mjs`
before starting.

## 2. What it actually is

**The window rows of the facade pattern crawl and flicker while the camera
moves, across the WHOLE CITY — not the Tower, not one building.**

The evidence is `shots/shimmer/mask-B-park-cinematic.png`. Every magenta pixel
is one that goes **A → B → back to A** across three frames of a steady camera
move. Real geometry under a monotonic camera change is monotonic; a pixel that
returns to where it started did not move, it flickered. The magenta lands on
window rows on essentially every building in frame, including downtown.

Numbers at the two reel-shot poses, 1440x900, cinematic:

| pose | frame moved | flickering pixels | biggest cluster |
|---|---|---|---|
| Shot A nearest the Tower | 51.2% | 1.76% | 1,235 px |
| Shot B parked pose | 52.8% | 1.50% | 2,252 px |

## 3. The instrument

`scripts/verify/shimmer-aba-prototype.mjs` is the throwaway that produced the
table and the mask. **It is a prototype and it has a known flaw**: its
thresholds are absolute on 0-255 channels and its flicker figure is a percentage
of the render buffer, so it is **not comparable across `renderScale`** — raising
renderScale made the number go UP, which is almost certainly the metric and not
the picture. A trustworthy meter is the first thing to build.

The method itself is sound and comes from `scripts/verify/zfight.mjs`:

* three frames, camera stepped **monotonically**
* flag pixels where `|f0 - f2|` is SMALL and `|f0 - f1|` is LARGE
* exclude pixels whose 3x3 neighbourhood is not flat — a z-fight is a surface,
  not an edge
* assert that the frame actually moved, or a null result is vacuous

**The one change from `zfight.mjs` that made the defect appear at all:** that
script steps **zoom** only. Stepping zoom found nothing (0.04–0.10%, no
clusters). Stepping **bearing and position** — the axes the flight actually
moves on — found it immediately. A depth or sampling tie is resolved by view
ANGLE, so a zoom-only step can miss it entirely.

## 4. Ruled out, by test and not by argument

* **The film grain.** Real, separate, and already fixed — every preset is now
  `grain: 0`. The shimmer survives it.
* **Geometry ties at the Tower.** `unstackShaft` lifted the shaft base to 20.2
  to clear `mb-piano`/`mb-entab`; the attic courses then run 20.2→24.4 against
  shaft slices 20.2→24.65, so a tie remains. A candidate `insetShaft` that pulls
  the shaft ring in 8 cm was built and **did not change the picture**. Not the
  cause of the reported defect.
* **The entrances layers, `tower-solid`, `tower-detail`, `parts-*`.** Hidden one
  at a time; the artefact survives all of them.
* **Supersampling.** `renderScale` 1.0 → 1.5 → 2.0 did not reduce it (see the
  metric caveat in §3 — this needs re-testing with a sound meter before it is
  called closed).
* **Graphics presets.** cinematic 1.18%, balanced 1.50%, performance 1.18% at
  the Shot B pose. No preset is an escape.

## 5. The leading hypothesis, NOT yet proven

`fill-extrusion-pattern` samples the sprite atlas with linear filtering and
**no mipmaps**. The window grid is a high-frequency pattern; once it is minified
past about one texel per screen pixel it aliases, and the alias pattern shifts
with the view angle. That is exactly "the windows crawl when I move".

If that is right, the fixes worth building are, in rough order of cost:

1. **Low-pass the generated pattern** so its energy sits below Nyquist at the
   minification the app actually flies at.
2. **A zoom-stepped pattern**: a coarse variant for far zooms, the detailed one
   up close, switched with `["step", ["zoom"], …]`.
3. **Fade the pattern toward the flat wall colour with distance**, so the
   aliasing has nothing to alias.

**Prove the mechanism before building any of them.** "It looks like aliasing" is
not evidence; a measurement of flicker against minification is.

## 6. Constraints

* `js/facades.js` owns the atlas. `window.FACADE_PATTERN_EXPR` is what
  `buildings-3d` reads.
* The atlas was reworked on 2026-08-19 and its main-thread share fell from ~46%
  to 2–3%. **Do not give that back.** Measure frame cost at cruise, headed,
  minimum of interleaved reps.
* Every taste value stays a named constant (CLAUDE.md rule 11).
* The vertical 0.12 m "barcode" stripe is a CLOSED question — geometry cannot
  fix it, real windows is the honest answer, and it is weeks of work. Do not
  reopen it as part of this.

## 7. What is now CLOSED (2026-08-22) — read before re-opening any of this

* **Root cause confirmed**: `docs/shimmer-mechanism.md`. Linear-filtered,
  no-mipmap `fill-extrusion-pattern` sampling, verified against the MapLibre
  v5.24.0 engine source in `docs/pattern-sampling.md` — there is no
  style-level lever to opt out, and the mechanism is continuous while any
  zoom-stepped tier is discrete, so no tier chain can remove it, only reduce
  its density. Do not re-derive this; read the two docs.
* **Three fixes were built, measured, and judged**: `docs/shimmer-verdict.md`
  and `docs/shimmer-cost.md`. `acer/shim-lowpass` (turn up the existing
  `SOFTEN` band-limit) shipped as a real, partial, blind-confirmed
  mitigation. Extending the `TIERS` zoom-stepped chain further
  (`acer/shim-zoomstep`) and fading the pattern out with distance
  (`acer/shim-fade`) were both built, measured, and are dead ends — do not
  re-try either without reading why first.
* **The second front is now CLOSED too, shipped 2026-08-22 evening (PR #215,
  merged, branches deleted)**: `docs/second-front-map.md` (per-file map),
  `docs/second-front-poses.md` (live measurement + two corrections to this
  brief's own six-file premise — `js/westcampus.js` was never part of this
  front, it already inherited the fix by reference; `street-drag`'s huge
  round-one number is mostly the already-tracked ground/road bug, not
  `js/drag.js`'s own layer), `docs/second-front-verdict.md` (all four ports
  shipped: `js/drag.js`, `js/tower.js` — the file Simeon actually named —
  `js/moody.js`, `js/arts.js`'s panel layer, `js/places.js`; `js/westcampus.js`
  needed zero code changes), `docs/second-front-cost.md` (frame cost,
  re-timed on the merged build: ~113.6ms combined added atlas-repaint cost
  across the five new ports, `js/facades.js`'s own row unchanged from round
  one — none of it in the render loop, cruise/flying fps unaffected by
  construction). Verified on production (flyover-utx.vercel.app) after
  deploy: crawl numbers match the merged build exactly, Tower crown intact
  at the Shot A opening pose, `?autopilot=1`/`?sliderdemo=1` both still work,
  zero console errors. **`js/heroes.js`'s seven pattern layers (EER, Dell CS,
  PCL-adjacent buildings) were found during this pass and are NOT ported** —
  flagged, not fixed, the next place to look if this is picked up again.
* **A meter pitfall, so it is not rediscovered**: a from-scratch rewrite of
  `shimmer.mjs` that downsamples every frame to a fixed reference grid before
  scoring (built to fix a real renderScale-comparability gap in the original)
  produced a confident, reproducible, visually-plausible WRONG answer — it
  said `shim-lowpass` made the crawl worse, at the exact poses three other
  independent measurements (the candidate's own commit, a blind judge pass,
  and a direct re-run with the ORIGINAL instrument) agreed it made better.
  Best explanation: stacking the new meter's own downsample-filter on top of
  an already-blurred candidate produces a different low-frequency beat
  pattern than either filter alone, which a 3-frame discriminator reads as
  MORE non-monotonic even though the native-resolution picture has less
  aliasing energy. The rewrite was not shipped. **Use the existing, original
  `scripts/verify/shimmer.mjs` for anything at a fixed renderScale** — it is
  the one three independent passes agreed with. If renderScale-invariance is
  ever needed again, that gap is real and worth fixing, but cross-validate
  any replacement against the original on a case with an independent answer
  before trusting it.
