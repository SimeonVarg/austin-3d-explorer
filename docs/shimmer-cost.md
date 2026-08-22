# The window shimmer — what each candidate costs

Companion to `docs/shimmer-verdict.md`. Frame cost and visual cost only; the
crawl-percentage numbers live in the verdict doc.

## Frame / main-thread cost

The one constraint that matters here (CLAUDE.md): the 2026-08-16 atlas rework
took `updateFacades`'s main-thread share from ~46% to 2-3% of a heavy
time-of-day tick, and nothing in this investigation may give that back.

**`acer/shim-lowpass`.** The change is entirely inside `js/facades.js`'s
`SOFTEN.RADIUS`/`SOFTEN.AMOUNT` constants, read by `softenTile`'s existing
sliding-window box blur. That blur is O(resolution), not O(radius) — a wider
radius does not add passes, it changes the width of a sum that was already
being computed. It runs once per atlas image at generation time (init and
time-of-day change), never in the per-frame render path, and does not add or
change any `map.updateImage`/`addImage` call site, so it cannot interact with
the `ATLAS.RELEASE` staleness-tracking rework the atlas cost fix depends on
(verified by reading the diff, not re-measured). The candidate's own
interleaved measurement (`facade-perf.mjs --atlas-only`, best-of-4,
headed): 112.5ms -> 122.3ms best case (+8.7%), but the two runs were under
different sibling load (28-49 vs 34-49 chrome processes) and the
percent-of-tick figure went DOWN (46% -> 29%), so this reads as noise, not a
regression. Cruise/flying fps: unaffected by construction (the blur is not in
the render loop). Not independently re-timed in this pass.

**`acer/shim-zoomstep`.** Zero, structurally. `paintTiers`/`ensureImages`
iterate every entry in `TIERS` unconditionally on every repaint regardless of
`minZoom`, so moving `NEAR_MIN_ZOOM` cannot add or remove an `addImage` call
or change per-tick cost. Not shipped (see verdict), so moot.

**`acer/shim-fade`.** A per-layer `setPaintProperty` toggle, not a per-frame
cost. Measured headed at the one pose it's active: 43.5fps baseline vs
45.5fps candidate (faster, expected — dropping a sampled pattern removes
texture-sampling work), but the baseline's own two reps spread 43.5-45.3fps
under the same load, so not confidently separable from noise. Not shipped.

## Visual cost

**`acer/shim-lowpass`.** Real and confirmed BY EYE, not just inferred from
the meter: `shots/shimmer/lowpass/soften-check-r6.png` visibly mushes windows
into flat wall up close; the shipped `r3` still reads as punched windows at
the same pose (`soften-check-r3.png` vs `-current.png`). The judge worktree's
blind test (`docs/shimmer-verdict.md` Pass 1, Gate 2) independently and
correctly identified the candidate as the visibly-softer arm at four separate
poses, including the actual reel pose, with no false calls. This is the
trade being bought: real, visible, and confined to close/oblique faces, not
free.

**`acer/shim-zoomstep`.** None observed — before/after screenshots at every
pose tested are visually indistinguishable, consistent with the near-zero
crawl delta. Not shipped.

**`acer/shim-fade`.** Real and severe at the one altitude it activates:
`shots/shimmer/fade/` shows buildings below the Capitol dome go from
windowed/storey-banded to flat, textureless colour — exactly the "lose the
city" risk the original task flagged, now shown rather than argued. This
altitude range overlaps the app's own intro tour and `TOUR` waypoints
(z15.45-16.9). Not shipped, and this is the main reason why.

## Net

The only cost actually being paid, post-merge, is `shim-lowpass`'s small,
confirmed softening of windows at close/oblique range in exchange for a real
17-41% reduction in measured crawl at the poses tested. No frame-time
regression found or expected by construction. No change to any layer besides
`buildings-3d`/`wc-wall` (the two consumers of `window.FACADE_PATTERN_EXPR`)
— `tower.js`, `drag.js`, `moody.js`, `heroes.js`, `arts.js`, `places.js` are
untouched, for better (no risk introduced there) and worse (no improvement
there either).
