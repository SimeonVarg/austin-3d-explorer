# The window shimmer — verdict on the three candidates

**Status: `acer/shim-lowpass` wins. It is a real, measured, blind-confirmed
partial mitigation and is the one merged. `acer/shim-zoomstep` and
`acer/shim-fade` do not fix the defect and are closed, not merged.**

This verdict merges two independent measurement passes that landed on the
same answer by different routes, plus a third pass (mine) that chased a false
lead first and is recorded here so nobody re-walks it.

## Pass 1 — the judge worktree (`wf_da80896e-b51-8`), full detail in that
worktree's own `docs/shimmer-verdict.md` before this file replaced it

Ten poses, `scripts/verify/shimmer.mjs` (the original 9-frame sign-change
instrument, unmodified), `balanced` preset (the real app default — not
`cinematic`, which the older prototype defaulted to). **Noise floor: 0.00
percentage points** — two separate `main` browser launches reproduced
byte-identical crawl%, moved%, and cluster boxes at all 10 poses, even under
24-26 concurrent chrome/node processes from sibling lanes.

| pose | main | lowpass | Δ | zoomstep | Δ | fade | Δ |
|---|---|---|---|---|---|---|---|
| shotA-reel | 4.00% | 2.87% | **-28%** | 3.88% | -0.12 | 4.00% | 0.00 |
| shotB-reel | 3.48% | 2.06% | **-41%** | 3.27% | -0.21 | 3.48% | 0.00 |
| bme-near | 8.57% | 6.37% | **-26%** | 8.57% | 0.00 | 8.57% | 0.00 |
| biolab-near | 7.28% | 5.90% | **-19%** | 7.28% | 0.00 | 7.28% | 0.00 |
| waggener-n | 9.96% | 8.29% | **-17%** | 9.97% | +0.01 | 9.96% | 0.00 |
| zoomcross-18 † | 45.48% | 42.81% | -2.67 | **45.48% (exact)** | 0.00 | 45.48% | 0.00 |

† zoom-mode poses are dominated by the separate, already-tracked ground/road
`fill-pattern` bug (`docs/GROUND_TEXTURE.md`) — deltas within a column still
mean something, the absolute numbers are not about this defect.

**Gate 2, blind**: four poses (`close`, `cruise`, `reelA` = shot-a-tower,
`midalt`), all four arms rendered, filenames shuffled and the mapping not
opened until after the call. Every call was correct: lowpass identified by
eye as visibly softer at every pose (Neural Molecular Science's near face at
`reelA`, the exact building this investigation's masks are keyed to);
zoomstep was the *least* different from `main` in every group, confirming no
visible cost either; fade's one active pose (`midalt`) showed two buildings
below the Capitol dome go from windowed to flat colour — a real, obvious
downgrade, and the "z-fight regression" claim in fade's own commit did not
reproduce against a fresh baseline (main and candidate read within 0.05pp of
each other at that pose once re-measured, not the 0.45pp gap fade's commit
reported).

## Pass 2 — a false lead, recorded so it is not re-walked

A trustworthy-meter rewrite (`shimmer.mjs` v2, box-filter downsample to a
fixed 720x450 reference grid before scoring, built to fix a REAL flaw in
`shimmer-aba-prototype.mjs`: its raw-framebuffer percentage is not comparable
across `renderScale`) was sitting uncommitted in the working tree from an
earlier, interrupted pass at this same task. It passed its own 4/4 selftest,
including the exact renderScale-invariance check it was built for, and was
used to independently re-measure shot-a-tower/shot-b-park.

**It reported the opposite of Pass 1: lowpass WORSE, not better** — 0.869%
to 1.197% at shot-a-tower (cinematic), reproduced 4 times exactly, confirmed
visually (its own mask shows MORE magenta on Neural Molecular Science's wall
in the candidate), confirmed at a second renderScale (1.5), and confirmed
after fixing a real, separate bug it had (a `>200` tiled-feature floor that
let a still-loading scene pass as ready — shot-a-tower was observed tiling
anywhere from 1522 to 4222 features at the identical pose depending on load;
fixed by requiring two consecutive stable reads, not just one floor-clearing
one). None of that was noise.

**Cross-checked against Pass 1's own instrument, run by me, independently, at
the identical two poses, `balanced` preset**: original `shimmer.mjs`,
unmodified, on the same two worktrees —

| pose | baseline | candidate | Δ |
|---|---|---|---|
| shot-a-tower | 3.51% | 2.64% | **-25%** |
| shot-b-park | 2.91% | 1.83% | **-37%** |

This reproduces Pass 1's direction and magnitude almost exactly (their
shotA/shotB-reel: -28%/-41%). **Three independent measurements now agree
(the candidate's own commit at different poses, Pass 1's blind-confirmed
10-pose sweep, and this direct re-run) against one outlier (the v2 meter).**
The v2 meter is the one that's wrong for this comparison, not the other
three. Best current explanation, not fully proven: the v2 meter's own extra
box-filter downsample stage is itself a low-pass filter, applied AFTER the
softening candidate's own low-pass — stacking two band-limiting stages on an
already-blurred signal can produce a *different*, coarser residual beat
pattern than either stage alone, which a 3-frame discriminator reads as MORE
non-monotonic even though the native-resolution image (what a viewer's
screen actually shows, never downsampled to 720x450) has less energy above
Nyquist. The v2 file was reverted to the original, committed `shimmer.mjs`
and not shipped — it is a real idea (renderScale-invariance is a genuine gap
in the original instrument) with a real flaw (it cannot be trusted for a
same-renderScale spatial-filter A/B, which is most of what this defect's
fixes need), and fixing that flaw is future work, not blocking this verdict.

## What tower.js/drag.js/moody.js means for this verdict

Independent of the lowpass A/B: **none of the three candidates could ever
have fixed the specific complaint** *"the bottom of the tower is having the
same window glitching problem."* `js/tower.js` (the Tower shaft + Main
Building), `js/drag.js` (PCL, Gregory Gym, Union, Co-op, the Guadalupe
streetwall) and `js/moody.js` (Moody Center, Dell Med) are each a closed
pattern system with their own atlas, and **none reference `facadeTierExpr`,
`TIERS`, or `SOFTEN`** — they draw the full-resolution pattern at every zoom,
unconditionally. All three candidates only ever touch `js/facades.js`. This
is a structural fact (confirmed by reading the four files), not a measured
one — it was not re-tested here, but it means the honest remaining fix has a
second front this investigation never touched.

## Ranked recommendation

1. **`acer/shim-lowpass` — merge.** Real, reproduced three independent ways,
   costs nothing per-frame (the blur runs once per atlas repaint, never in
   the render loop — verified by reading the diff: it only changes constants
   fed into an existing sliding-window box blur, no new call sites), visible
   cost is real but small and confined to close oblique faces, confirmed
   blind.
2. **`acer/shim-zoomstep` — do not merge.** Zero measured or visible benefit
   anywhere, including at a pose built specifically to cross its own new
   tier boundary. Its own decisive test (forcing 100% far tier) shows the
   far tier's own prefilter, not the switch point, is the ceiling — no
   value of the threshold fixes that.
3. **`acer/shim-fade` — do not merge.** Inert at both actual reel poses
   (they sit above its `FADE_ZOOM`), visibly flattens real buildings at the
   one altitude it does anything, and its own regression claim did not
   reproduce.

**One sentence for Simeon**: none of the three fixes the glitch you're
seeing — lowpass takes the worst spots from roughly 8-10% crawl down to
roughly 6-8%, worth keeping because it's a real, free, mostly-invisible
softening, but the windows still visibly crawl afterward, and it never
touches the Tower's own base at all (that's a separate, untouched code path).

## What this did NOT establish

- Whether the v2 meter's downsample-artifact theory is exactly right —
  plausible and consistent with everything measured, not proven with a
  synthetic counter-example.
- Whether `tower.js`/`drag.js`/`moody.js`'s missing tier/soften machinery is
  a measurable contributor to the citywide crawl, versus the core atlas
  alone — a structural fact offered to the next lane, not a measured one.
- Frame/render cost was not independently re-timed in this pass; the
  candidate's own measurement (atlas-generation cost, not per-frame, +8.7%
  best-case inside load noise) was checked for plausibility by reading the
  code path, not re-run.
- Whether WebGL2 anisotropic filtering or a per-tile (not atlas-wide) mipmap
  could be retrofitted onto MapLibre's pattern atlas without engine changes —
  `docs/pattern-sampling.md` flags this as unexplored and it remains so.
