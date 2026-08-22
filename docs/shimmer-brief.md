# The window shimmer — what is established, so nobody re-derives it

**Status: OPEN. This is the defect, not a theory about it.**

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
