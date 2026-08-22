# Candidate 2 (grazing-angle ground fade) — verdict

**Status: DOES NOT MOVE THE NAMED DEFECT. Built, shipped as `GROUND.pitchFade`
(pitch-keyed, not zoom-keyed — see why below), measured, and the measurement
says the three layers it touches are not the source of street-drag's crawl.
Not merged. This is a refusal on the merits, not an unfinished build.**

## What was built

`js/ground.js`'s `GROUND.pitchFade` block, wired up at the end of `initGround`
(`groundPitchFadeMul`/`refreshGroundPitchFade`, exposed as
`window.applyGroundPitchFade`). It fades `TEX`/`CLOSE_AREA`/`CLOSE_ROAD` —
the three plain `fill-pattern` layers the task brief named as carrying zero
band-limit treatment — toward their existing flat `fill-color` siblings as
camera **pitch** climbs past `GROUND.pitchFadeLo` (66°), reaching
`GROUND.pitchFadeFloor` (0, fully flat) at `GROUND.pitchFadeHi` (77°).

### Why pitch, not zoom (read this before re-proposing a zoom fade)

`docs/pattern-sampling.md` read the actual MapLibre v5.24.0 source
(confirmed independently here against `fill_pattern.fragment.glsl`: the
uniform list is `u_texsize`/`u_fade`/`u_image`, nothing distance- or
fog-shaped). The only camera-varying input any paint property can read is
`["zoom"]`, and zoom is ONE number for the whole frame — it cannot spare the
kerb under the camera while fading the horizon in the same frame, which is
why a zoom-keyed fade already lost once, for facades
(`docs/shimmer-verdict.md`, `acer/shim-fade`).

The ground is not a building, though — it's one continuous plane, and pitch
(not zoom) is what turns a face-on view of it into a grazing one, uniformly,
everywhere the plane is in frame. Pitch isn't a valid `interpolate` input in
the style spec, so it's read imperatively off the camera (`map.getPitch()`)
on a throttled `pitch` listener and pushed into the paint properties as a
plain multiplier, not baked into a style expression. This is genuinely
different machinery from the facade candidate that lost, and it is the
smallest honest thing that could plausibly separate "under your feet" from
"the horizon" at all, given the constraint above.

**It is still one number for the whole frame.** A translate-mode low pass
(street-drag) holds pitch fixed for the entire flight, so within that one
flight it is a single on/off switch for the WHOLE visible ground, not a
per-pixel gradient. That honest limit was flagged before measuring, not
discovered after losing.

## The measurement that actually decided this

Before tuning any threshold, `SHIM_ONLY` (extended here to handle `fill`,
`background` and `line`-type layers, not just `fill-extrusion` — see the
`scripts/verify/shimmer.mjs` diff and why below) was used to fully strip,
one group at a time, every pattern/fill/line layer `js/ground.js` owns, at
`street-drag` (whole frame) and `street-drag-groundbox` (boxed to
`[0,559,1439,899]`, the exact two full-width clusters the verdict lane
named). `scripts/verify/shots-g-zoomfade-sd.json` is the pose file.

| strip | street-drag | street-drag-groundbox |
|---|---|---|
| baseline (nothing stripped, pre-candidate) | 38.27% | 77.79% |
| TEX + CLOSE_AREA + CLOSE_ROAD (this candidate's own 3 layers, fully off) | 38.27% | 77.79% |
| + ROAD, PATH_TEX, CLOSE_PATH, BASE_TEX (every other ground fill/fill-extrusion pattern) | 38.27% | 77.79% |
| + literally every remaining `js/ground.js` layer (AREA, PATH, casings, LANE dashes, bike lanes, cycleway, stopbar, creek/depth/canopy/deck) — every fill, fill-extrusion, background AND line-dasharray this file owns | 38.27% | 77.79% |

**Every number in every row is byte-identical, to two decimal places, at
every stage.** `js/ground.js` was stripped down to nothing this file paints
— not one pixel of it left patterned, textured, dashed, or even colour-
varied — and street-drag's crawl did not move by one hundredth of a point.
Masks: `shots/shimmer/ground/zoomfade/street-drag-baseline-mask.png` vs
`street-drag-exhaustivestrip-mask.png` (and the `-groundbox-` pair) — visibly
identical, same two full-width clusters in the same place.

**Byte-identical at every stage tried against this candidate's own three
layers, and against every other fill/fill-extrusion pattern `js/ground.js`
owns.** Full removal (not a partial fade) of `TEX`/`CLOSE_AREA`/`CLOSE_ROAD`
moves street-drag's crawl by exactly 0.00 points. A pitch-keyed partial fade
of the same three layers cannot do better than their own full-strip floor —
so this candidate cannot touch the task's own headline pose, full stop,
independent of any threshold tuning.

This also corrects the brief's own citation: "byte-identical pixel counts at
every blur radius the helper lane swept" was quoted as evidence blurring
doesn't help the ground. It doesn't show that — `SHIM_SOFTEN`'s registry
list in `shimmer.mjs` (`facade,drag,tower,moody,arts,places`) has no
`ground` key, so that sweep never touched `js/ground.js`'s images at all;
"byte-identical" there was trivial, not a finding. This pass's byte-identity
is a different, real result, from a lever (`SHIM_ONLY`, full removal) that
demonstrably works elsewhere in this same file (see the `SHIM_ONLY` bug fix
below, needed before it could even run against `fill`-type layers).

## What street-drag's ground band actually is — a correction to the shared record

**It is not `js/ground.js`.** That premise, stated as settled fact in this
task's own brief, in `docs/second-front-verdict.md`, and in `js/drag.js`'s
own softening-sweep comment ("That is js/ground.js's OWN, ALREADY-TRACKED
`fill-pattern` zoom-aliasing bug... a different render path this fix has no
way to reach"), does not survive contact with an actual isolation test.

`js/drag.js`'s own comment (lines ~250-257) independently noticed the same
signature I found — "one cluster reads EXACTLY 231239 px at every radius
tested, 0 through 6 — untouched to the pixel" — and concluded, from that
alone, that it must be `js/ground.js`'s pattern (cited to
`docs/GROUND_TEXTURE.md`/`pattern-scale.mjs`, which document that
`fill-pattern` CAN alias on zoom reset in general, not that it DOES so at
this pose). Nobody had actually stripped `js/ground.js`'s layers at this
pose before this pass. Having now done that exhaustively — every fill,
fill-extrusion, background and dashed line the file owns, individually and
combined — that exact 231239 px cluster is untouched by ground.js too, at
every combination, not just by drag.js's own softening radius.

Two things can both be true and reconcile this: `pattern-scale.mjs` is
correct that `fill-pattern` CAN alias on integer-zoom reset in the abstract,
and this specific 231,239 px cluster, at this specific pose, is not that.
Its signature (`flips/px` near 2.0 — see the CONFIG lines in the commit —
a very regular, near-exact 2-flip cadence rather than the noisier
many-flip pattern texture aliasing produces elsewhere in this investigation)
reads more like a **coplanar/z-fighting tie** between two surfaces trading
the top pixel every other frame than like texture minification — but that
is a hypothesis, not measured here; `scripts/verify/zfight.mjs` and
`coplanar.mjs` are the instruments for it and neither was run against this
pose in this pass. What IS measured, decisively: it is not `js/ground.js`'s
pattern, colour, or geometry, in any combination.

## The near-camera control (the thing this candidate was supposed to protect)

`eyelevel-drag` (standing, pitch 55, below `pitchFadeLo`) measures 54.67%
crawl at the same corridor pre-candidate, and its mask
(`shots/shimmer/ground/zoomfade/eyelevel-drag-baseline-mask.png`) shows genuine
fine-grained speckle across the CLOSE_AREA/CLOSE_ROAD tiles — this pose IS
sensitive to this candidate's three layers, unlike street-drag. Colour
screenshots with the fade forced on and off at this pose
(`shots/shimmer/ground/zoomfade/eyelevel-drag-fadeON.png` /
`-fadeOFF.png`, `scripts/verify/shot-fade-ab.mjs`) are pixel-for-pixel
identical, exactly as the code guarantees (pitch 55 < `pitchFadeLo` 66, so
`mul === 1` and the wrapped expression is never even substituted) — so the
authored grain a person would actually stand on is untouched, provably, not
just plausibly.

At `eyelevel-lookout` (standing, pitch 78 — above `pitchFadeHi`, fully
faded), the colour screenshots
(`shots/shimmer/ground/zoomfade/eyelevel-lookout-fadeON.png` / `-fadeOFF.png`)
are near-indistinguishable BY EYE in a single static frame — the sidewalk's
scored joints and the road's own colour read the same either way, because
these layers' own opacity was already modest (`texOpacity` 0.62,
`closeStrength` 0.45-0.65 before any per-family multiplier) even at full
strength. That is expected and not a contradiction: `shimmer.mjs` measures
TEMPORAL non-monotonicity across a camera step, not static appearance, so a
fade that looks nearly the same in one frame can still remove flicker across
several. **The crawl% delta at this pose was not captured** — the run was
killed after ~8 minutes under the same heavy sibling load (27-40 concurrent
`chrome.exe`) that made every measurement in this pass slow; the mechanism
and the visual non-regression are both confirmed, the number is not.

## Recommendation

**Do not merge for the stated purpose.** The mechanism is sound and the
implementation is small, named-constant, and provably inert below its own
threshold — but it cannot move street-drag or street-drag-groundbox by
construction, because the layers it fades are not where that crawl lives.

The feared cost did not materialise either, worth stating plainly since it
cuts against merging for a different reason (no benefit, not "too risky"):
`shot-a-tower` (pitch 74) and `shot-b-park` (pitch 72) — the reel's own
poses, both inside this candidate's fade ramp — measure 2.62%/1.80% WITH
the fade active, against 2.64%/1.83% previously established for the current
`main` at the same poses. That is noise-floor, not a regression. So this
candidate is neither harmful nor helpful at the poses that matter most; it
is simply inert everywhere it was checked except the one pose
(`eyelevel-lookout`, pitch 78, standing and looking toward the horizon) it
was designed to reach, and even there it was not scored against the task's
own headline defect.

The honest next step, if anyone picks this up: `ground-road-lane` (the
dashed centre line) was ALSO in the exhaustive strip and is ALSO ruled out —
the 231,239 px cluster survives every `js/ground.js` layer, individually and
combined, dashes included. So the source is outside this file entirely.
Start with `scripts/verify/zfight.mjs`/`coplanar.mjs` against this exact
pose (`street-drag`, `[-97.7417,30.288598]` z19.017 pitch76 bearing180) —
the `flips/px` signature (~2.0, very regular) reads more like two surfaces
trading a depth-test tie than like texture aliasing, and neither instrument
has been pointed at this pose yet.

## What this did NOT establish

- What the 231,239 px cluster actually IS — the exhaustive strip proves it
  is not `js/ground.js`, `js/drag.js`'s own softening sweep proves it is not
  that module's pattern radius either. A coplanar/z-fight tie is the leading
  guess by signature (flips/px near 2.0), not a measured conclusion —
  `zfight.mjs`/`coplanar.mjs` were not run against this pose in this pass.
- The exact `shimmer.mjs` crawl% delta at `eyelevel-lookout` with the
  candidate active — killed under load before it finished; the colour
  screenshots and the eyelevel-drag control stand in for it but are not a
  substitute for the number.
- Frame cost of the `pitch` listener itself — not measured; expected
  near-zero since it only fires on an actual pitch change and is quantised
  to 1°, but not timed.
- Sibling candidates 1 and 3's own numbers, for comparison.
