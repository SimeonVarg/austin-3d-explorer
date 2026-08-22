# The street-drag ground crawl — round three, refused, and the premise it corrects

**Status: NOT FIXED. Three independent candidates were built, measured, and
refused. None merged, none moved the number. The investigation's own working
premise — that this was `js/ground.js`'s own `fill-pattern` texture aliasing,
the same class of bug the window shimmer was — is WRONG, and that is the real
finding of this round.**

## The starting number, reproduced independently here

`street-drag` (a low pass down Guadalupe, `zoom 19.017, pitch 76, bearing 180`)
measured 38.27% whole-frame crawl on `origin/main` (588f383) at the start of
this round, and it is confirmed **byte-identical** across four independent
measurements now: the round-two verdict, and all three candidates below —
plus one more direct re-run done for this writeup, on the same commit, same
instrument, same pose:

```
street-drag             38.27% crawl   (whole frame)
street-drag-ground      77.79% crawl   (boxed to y559-899, the two full-
                                         width clusters — see below)
```

Two clusters dominate the boxed number and are **pixel-count identical, to
the pixel, in every measurement run by every candidate**: 231,239 px
(box 0,559–1439,816) and 148,795 px (box 0,747–1439,899). A third, much
smaller cluster (771–33,000 px depending on box) moves around and is not
part of this story.

## The three candidates, what each one is, and why each lost

### 1. `acer/g-blur` — isotropic band-limit on `js/ground.js`'s own images

Ported the same `window.PatternLowpass.blurWrap` kernel that fixed the window
shimmer (facades, tower, drag, moody, arts, places) onto ground's four
pattern-drawing functions (far-field texture, close-range grain, the Speedway
herringbone, the sidewalk scoring). Conservative, taste-protected radii,
gated behind a new `GROUND_SOFTEN` table so it could be swept.

**Result: moved the crawl number by exactly 0.00 percentage points, at every
radius tested, from zero softening up through the shipped table.** Not "a
small improvement" — genuinely zero, to the hundredth of a point, and the two
dominant clusters kept the identical pixel count at every radius.

**Why**: a follow-up test hid every one of `js/ground.js`'s own six
pattern-bearing layers, one at a time and then all at once. The crawl number
did not move even when NOTHING ground.js paints was left on screen. A blur
cannot fix content it was never touching.

### 2. `acer/g-coarse` — redraw the grain coarser at the source

Instead of blurring after the fact, this drew the same speckle noise onto a
smaller sub-canvas and let the browser's own upscaling soften it before it
ever reaches the tile — fewer, larger, already-soft grain by construction,
across every family that uses the shared `speckle()` primitive.

**Result: also exactly 0.00 percentage points**, at a normal setting and at
an 8x stress setting that visibly wrecked the intended "aggregate stone"
look in a still frame. And it was not free: cold-load time went from 19.4s
to 24.8s (+27%), a real cost for zero benefit.

### 3. `acer/g-zoomfade` — fade the ground pattern out at grazing pitch

The most different idea of the three: rather than touching pixel content,
fade `TEX`/`CLOSE_AREA`/`CLOSE_ROAD` toward their flat colour siblings as
camera **pitch** (not zoom — zoom is one number for the whole frame and
can't spare the near field while fading the horizon) climbs past 66°,
reaching fully flat at 77°.

**Result: also exactly 0.00 percentage points.** This is the candidate that
found out why: it went further than the other two and stripped **every
single fill, fill-extrusion, background, and dashed-line layer
`js/ground.js` owns** — not just the three patterned ones, everything the
file paints — individually and all at once. The two dominant clusters
(231,239 px and 148,795 px) survived every combination, byte-identical.
**`js/ground.js` was reduced to painting nothing, and the crawl was
unchanged.**

No regression either, worth noting since it argues against "too risky, not
"no benefit": the reel's own poses (shot-a-tower, shot-b-park) read within
noise floor with the fade forced on, and the near-camera walking view is
provably pixel-identical below the fade threshold. It simply doesn't reach
the pose that matters.

## What the crawl actually is — the correction to the shared record

**The dominant street-drag crawl is not `js/ground.js`, at all.** That belief
was the working assumption of this entire round (and was stated as fact in
`docs/second-front-verdict.md` and in a comment in `js/drag.js` itself) —
and it does not survive an actual isolation test. Nobody had stripped
ground.js's own layers at this exact pose before this round; once someone
did, twice, independently, the answer was the same both times.

The leading clue for what it actually is: the boxed pose's flip-rate signature
is `flips/px ≈ 1.999` — a near-exact two-flip cadence, not the noisier,
many-flip signature texture aliasing produces everywhere else in this
investigation (windows, facades). That shape — one pixel trading between two
states on almost every frame — is the signature of **two coplanar or nearly
coplanar surfaces trading the top depth-test result**, a z-fighting tie, not
a minification/pattern problem. This is a hypothesis from elimination and
signature, not a confirmed finding: `scripts/verify/zfight.mjs` and
`coplanar.mjs` exist for exactly this and were never pointed at this pose.

If that hypothesis is right, this was never the same bug family as the
window shimmer at all — it only looked related because both defects live in
the same demo pose and both show up as flicker under `shimmer.mjs`.

## Verdict

**Refuse all three. Merge nothing.** Two are provably inert (zero measured
effect, no way to be otherwise once ground.js's own layers are proven
uninvolved); the third (`g-coarse`) is inert AND costs real load time. None
of them touch the actual defect because none of them could have — the
defect isn't in the file any of them changed.

This is not a failure of effort — the ground pattern map
(`docs/ground-pattern-map.md`) correctly worked out everything about how
`js/ground.js`'s patterns sample and where the anisotropy risk would show up
if this had been that bug. It wasn't. The isolation test is the actual
finding of this round, and it is worth more than a shipped-but-useless blur
would have been.

## The honest remaining option

Point `scripts/verify/zfight.mjs` and `coplanar.mjs` at the exact
`street-drag` pose (`center [-97.7417, 30.288598], zoom 19.017, pitch 76,
bearing 180`) and find which two surfaces are trading the depth-test tie in
the two dominant clusters. That is a different bug class from everything
this document's three candidates tried — geometry/depth-precision, not
texture. Nobody has run either instrument against this pose yet. Until that
is done, "what causes the street-drag ground crawl" is genuinely unknown —
this round only established what it is *not*.

## What this document does NOT establish

- What the 231,239 px and 148,795 px clusters actually are — only that they
  are not `js/ground.js`'s pattern, colour, geometry, or dashed lines, in any
  combination.
- Whether the z-fight/coplanar hypothesis is correct — it is the best-fitting
  signature match, not a measurement with either dedicated instrument.
- Whether the same crawl shows up at other poses in the city (only
  `street-drag` and its two boxed variants were re-measured for this
  writeup; the three candidates' own docs have additional pose coverage —
  `docs/g-zoomfade-verdict.md` §"the near-camera control" is the fullest of
  the three).
- Frame-render cost of any candidate at cruise/flying framerate — none was
  timed this session beyond `g-coarse`'s cold-load number; the other two are
  either structurally one-time-only (`g-blur`, draws once at page load) or
  expected-but-unmeasured near-zero (`g-zoomfade`'s throttled pitch
  listener).
