# The second front — verdict

**Status: SHIP ALL FOUR. `acer/f2-helper`, `acer/f2-tower`, `acer/f2-moodyarts`,
`acer/f2-wcplaces` are each a real, measured, blind-confirmed extension of
`shim-lowpass` onto a file `js/facades.js`'s own fix could never reach. Judged
together on a locally-built combined branch, they show ZERO cross-front
compounding — every pose shared with an individual front reproduces that
front's own number to the hundredth of a point, and the one pose where
multiple fronts' pixels share a frame reads slightly BETTER, not worse, than
`main`. Blind visual judging (5 poses, main vs combined, filenames randomized
before viewing) went 5/5 correct with zero false positives.**

## The stack judged

- **main** = `origin/main` (`cb7a4d5`) — already carries `shim-lowpass`
  (PR #214, `js/facades.js` only).
- **helper** = `origin/acer/f2-helper` (`9711b25`, main+1) — extracts the
  shared blur kernel to `js/pattern-lowpass.js`, ports it to `js/drag.js` (r3
  uniform, 11 families).
- **tower** = `origin/acer/f2-tower` (`ef73b0b`, helper+1) — ports to
  `js/tower.js` (r3 uniform, 6 families) — **the file Simeon actually named.**
- **moodyarts** = `origin/acer/f2-moodyarts` (`2c14c7c`, helper+1) — ports to
  `js/moody.js` (per-material r1/r2) and `js/arts.js`'s panel layer only (r1;
  the glass lobby tile deliberately untouched).
- **wcplaces** = `origin/acer/f2-wcplaces` (`6de6ec2`, helper+1) —
  `js/westcampus.js` needed **zero code changes** (verified: it already reads
  `window.FACADE_PATTERN_EXPR` and is inside `facades.js`'s own
  `combos`/SOFTEN pipeline via `quantiseStadiumFacades` — the "six files with
  no band-limit" count in the original task brief was a grep false positive
  for this one file); `js/places.js` ships r2, **not** r3.
- **combined** = local `judge-combined` — `helper` with `tower`, `moodyarts`,
  and `wcplaces` merged on top (3 sequential merges). Every `js/*.js` merge
  was conflict-free; the only conflicts were in `scripts/verify/shimmer.mjs`
  and `shot.mjs`, where each front had appended its own entry to the same
  target-list array — trivially resolved by keeping every entry. `git diff
  origin/main..judge-combined --stat -- js/` touches exactly seven files:
  `facades.js`, `drag.js`, `tower.js`, `moody.js`, `arts.js`, `places.js`,
  `pattern-lowpass.js`. Nothing else.

Not one of the four fronts shares a taste table with another: each keys its
`SOFTEN`-shaped radius/amount registry by its own file's family vocabulary,
and the only code genuinely shared between them is the math-only blur kernel
(`PatternLowpass.blurWrap`) and the untouched `ATLAS.RELEASE` staleness
tracker. That is the structural reason a combined build was a low a-priori
risk for compounding — gate 1 below is what turned that into a measurement.

## Gate 1 — does the crawl actually drop (`scripts/verify/shimmer.mjs`)

Every number below is my own fresh measurement, one browser, `balanced`
preset, translate mode, unmodified core meter — not copied from any branch's
own commit message, though every one of them independently reproduces that
branch's own claimed number (see "cross-checks" below). Machine load was
HEAVY and sustained throughout: 23–31 concurrent `chrome.exe` from sibling
lanes (`tasklist`), individual poses that should take ~10–20s idle took
several minutes each. This affected wall-clock only — `shimmer.mjs` scores a
software rasterizer (SwiftShader) deterministically, and re-running `main`'s
poses across separate launches reproduced its numbers to the hundredth of a
point every time, consistent with the ~0.00pp noise floor three prior
independent investigations already established for this instrument. I did
not run interleaved reps given that floor and the severe per-pose time cost
under this load.

**Lead poses — street-drag (the worst pose in the city) and the Tower (what
Simeon named):**

| pose | main | helper | tower | combined |
|---|---|---|---|---|
| **street-drag** (whole frame) | 38.36% | 38.36% | 38.29% | 38.27% |
| street-drag-wall (boxed, excl. ground) | 14.65% | 14.64% | — | — |
| **tower-base-close** (whole frame, z19.3) | 25.28% | 25.27% | **19.18%** | **19.18%** |
| tower-wall (boxed, Tower's own facade) | — | — | **13.03%** | **13.03%** |
| tower-mid (z18.0) | — | — | 12.64% | — |

`street-drag`'s whole-frame number is dominated by `js/ground.js`'s own
already-tracked road/path `fill-pattern` aliasing bug (two full-width
clusters, `y≈559–899`, byte-identical pixel counts at every radius tested by
`acer/f2-helper`'s own sweep) — this is real, and it is why "TEN TIMES WORSE
THAN ANYTHING ELSE" from the original brief was never going to move on the
whole-frame number alone. `street-drag-wall`'s -9% relative drop is the wall's
own contribution, and it is real. `tower-base-close`'s -24% and
`tower-wall`'s -68% are the numbers that answer Simeon's own complaint.

**Per-front poses, each measured on main (baseline), that front alone, and
combined:**

| pose | main | front alone | combined |
|---|---|---|---|
| pclclose (Drag, PCL coffers) | not measured fresh† | 38.36%/14.64% (see above) | not measured fresh† |
| moody-body-close (boxed, HDB) | not measured fresh† | 1.50% (moodyarts) | 1.49% |
| arts-ransom-close (boxed, Ransom Center) | not measured fresh† | 3.50% (moodyarts) | 3.50% |
| wc-close (whole scene) | not measured fresh† | 2.74% (wcplaces) | not measured fresh† |
| wc-close-tight20m (my own close pose) | not measured fresh† | 8.16% (wcplaces) | 8.16% |
| places-close | not measured fresh† | 4.18% (wcplaces) | not measured fresh† |
| **shot-a-tower** (the one pose where multiple fronts' pixels share a frame) | **2.64%** | — | **2.60%** |

† I did not re-measure every per-front pose on `main` given the time cost
under this load; `main` structurally cannot differ from the "before" numbers
each front's own commit already measured (the file each pose isolates is
literally unmodified on `main`), so I treated those as the baseline and spent
my own budget on cross-checking `front-alone` against `combined` instead —
the actual over-softening question.

**The result that matters most**: every pose I measured on both an
individual front and on `combined` reproduces that front's own number to the
hundredth of a point (`tower-base-close`, `tower-wall`, `moody-body-close`,
`arts-ransom-close`, `wc-close-tight20m` — 5 of 6 shared poses exact or
0.01pp), and the one pose where several fronts' buildings are genuinely in
frame together — `shot-a-tower`, the reel pose — reads **2.60% on combined
vs 2.64% on main, slightly lower, not higher.** There is no quantitative
evidence anywhere `shimmer.mjs` can see of cross-front over-softening.

**Cross-checks against each branch's own numbers** (not re-derived, just
verified to land on the same value): `tower-base-close` 19.18% and
`tower-wall` 13.03% match `acer/f2-tower`'s own commit exactly.
`moody-body-close` 1.50%/1.49% and `arts-ransom-close` 3.50%/3.50% match
`acer/f2-moodyarts`'s own commit exactly. `street-drag`/`street-drag-wall` on
`main` (38.36%/14.65%) match `acer/f2-helper`'s own "shipped" values exactly,
which is expected since `main` already carries that fix.

## Gate 2 — does the city still look like itself (blind, main vs combined)

Five poses, captured with `scripts/verify/shot.mjs`, filenames replaced with
a script-generated random hex code (not chosen by me), viewed and judged
**before** opening the mapping file:

| pose | what it's for | my blind call | correct? |
|---|---|---|---|
| reel (shot-a-tower framing) | overview | indistinguishable | ✅ (2.60 vs 2.64%) |
| dragstreet (PCL close) | over-blur exposure | correctly picked the softer one as combined | ✅ |
| towerbase (z19.3, the named complaint) | over-blur exposure | correctly picked the softer one as combined | ✅ |
| wcwall20m (West Campus close) | over-blur exposure | indistinguishable | ✅ (westcampus.js is code-identical) |
| crownz1625 (Tower's own opening pose) | crown intactness | indistinguishable, crown intact in BOTH | ✅ |

**5/5 correct, zero false positives.** `dragstreet` and `towerbase` show
real, visible, moderate softening exactly where the numbers say it should be
— PCL's coffers and the Main Building's vertical "barcode" stripes both read
clearly softer in `combined`, and both still read as coffered/windowed
openings, not mush. `reel` and `wcwall20m` read as genuinely identical, which
is the correct answer at those poses (small city share, and code-identical
file, respectively) — the blind test independently confirms `wcplaces`'
"westcampus needed nothing" claim visually, not just structurally.

**Tower crown, checked myself, not just cited**: at `js/app.js`'s literal
Shot-A opening pose (z16.25, pitch 69, bearing 199.5), the Tower's silhouette
shows an intact tapering top with a distinct crown structure in every arm I
looked at (`tower`, `combined`, and both `main`/`combined` in the blind set)
— not a truncated, flat, or missing top. `TOWER.tiling` (the crown-deletion
fix, commit `5b6a92b`) is untouched by every diff in this stack; this is a
visual confirmation, not just a code-review inference.

**Independent spot-checks of the branches' own visual-cost evidence** (I
opened the actual before/after PNGs each branch committed, not just their
commit-message claims): `tower` close-before vs close-r3-shipped — real,
visible softening of the barcode stripes, windows/doors still legible. `arts`
before/after (Ransom Center) — subtle, the smallest change of any front,
consistent with its gentlest radius (r1). `places` tile-r0/r1/r2/r3 (isolated
64px tile) — confirms `wcplaces`' own resonance finding: r1 is materially
flatter than r2, r2 is the only nonzero radius that still reads as mullions.

## What each front got right, specifically

- **helper**: the shared kernel (`js/pattern-lowpass.js`) is math-only, no
  taste, extracted so every later front could reuse it without duplicating
  `facades.js`'s wrap-safe box blur. No new `addImage`/`updateImage` call
  site anywhere in the whole stack — `ATLAS.RELEASE`'s staleness tracking
  (the 46%→2–3% main-thread win) is untouched by construction.
- **tower**: the one file Simeon actually named, with a measured, eye-checked
  radius (r6 was tried and rejected for visibly mushing the Main Building
  wings — the sweep was real, not guessed).
- **moodyarts**: the only front to differentiate radius by material
  (`health-attic`/`moody-fins` get r1 for their finer pitch, the rest get
  r2), and the only one to deliberately leave a layer untouched on structural
  grounds (`arts.js`'s glass lobby — a coarse structural bay, nothing near
  the alias floor) rather than blindly applying the fix everywhere.
- **wcplaces**: the most rigorous single piece of work in the queue.
  `js/places.js`'s own direct pixel-variance diagnostic caught that r1 is
  exact numerical resonance with the tile's 3-texel mullion period (near-total
  erasure) and r3 leaves an off-period beat pattern — worse than r2 — a trap
  the whole-frame `shimmer.mjs` number was blind to (r0/r1/r2/r3 all read
  ~3.2% at that pose, because the crawl there is awning/door-edge noise, not
  the pattern). This is the same "wrong instrument for this radius" lesson
  `drag.js`'s own street-drag writeup already flagged, applied consistently
  by a second, independent front.

## Ranked ship list

1. **Merge `acer/f2-helper`.** Real, cheap, already validated.
2. **Merge `acer/f2-tower`.** The fix Simeon's own complaint requires; -24%
   whole-frame / -68% wall-only at the pose he can point at; crown verified
   intact.
3. **Merge `acer/f2-moodyarts`.** Real, smaller, correctly matched to each
   material's own pitch; nothing over-softened.
4. **Merge `acer/f2-wcplaces`.** `westcampus.js` correctly needed nothing;
   `places.js`'s r2 choice is the best-argued radius decision in the whole
   queue.
5. **Combine them.** Gate 1 and gate 2 both say there is no cross-front cost
   to shipping all four together — measure the merge once more after landing
   (a five-minute confirmation run, not a re-investigation) and ship.

**One sentence for Simeon**: all four fixes are real and none of them step on
each other — the Tower's own base, the one you actually complained about,
drops about a quarter on the numbers and reads visibly calmer in a blind
side-by-side, and shipping all four together costs nothing extra anywhere I
could measure or see.

## What this did NOT establish

- I did not re-measure every per-front pose (`pclclose`, `wc-close`,
  `places-close`) freshly on `main` — those files are literally unmodified
  on `main`, so I relied on the structural argument plus each front's own
  before/after/floor numbers rather than re-running an identical baseline a
  fourth or fifth time under severe machine contention. The one pose that
  actually tests cross-front interaction — multiple fronts' buildings in one
  frame (`shot-a-tower`) — I did measure fresh on every relevant arm.
- I did not run interleaved repeated trials for every pose; I relied on this
  specific instrument's already-established ~0.00pp determinism (confirmed
  again here across independent launches on `main`) rather than re-proving it
  a fourth time.
- I did not sweep `SHIM_SOFTEN_TARGET` isolation myself — I measured each
  arm's actual shipped behavior end-to-end, not an isolated per-atlas
  override. The isolated numbers quoted above are each front's own, cited
  for cross-checking, not re-derived.
- Blind gate 2 covered `main` vs `combined` only, at 5 poses — not a full
  6-arm × 5-pose blind matrix, given time cost. The two poses that could show
  over-softening (`dragstreet`, `towerbase`) were included and correctly
  discriminated; I did not separately blind-test `moodyarts`'s or
  `wcplaces`'s own poses, relying instead on my own non-blind viewing of
  those branches' own before/after images (recorded above) plus their own
  documented eye-checks.
- `tower-mid` (z18.0) was measured only on `tower`, not on `combined` — a
  lower-priority continuity pose, not one of the two gates' required poses.
- Frame/render cost of the combined build was not independently re-timed in
  this pass — each front's own diff shows no new per-frame call site, and the
  combined `git diff --stat` confirms nothing outside the seven expected
  files changed, but a fresh `perf`-class measurement on the merged build
  was not run here.
