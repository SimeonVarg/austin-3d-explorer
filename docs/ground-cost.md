# Ground-crawl round three — frame and load cost

None of the three candidates in `docs/ground-verdict.md` shipped, so **none of
this changes production.** Written down anyway because two of the three
numbers below are real and worth not re-measuring next time someone reaches
for the same idea.

## `acer/g-coarse` — the one real cost measured this round

Interleaved cold-load timing (nav-start to veil-removed), minimum of 2 reps
each, same heavy machine load (18+ concurrent `chrome.exe` from sibling
lanes) applied to both sides of the pair so the comparison is fair even
though the absolute numbers are inflated by that load:

| | cold load |
|---|---|
| baseline (`origin/main`) | 19.41 s |
| `g-coarse` (grainDownsample=3) | 24.76 s |
| delta | **+5.35 s, +27%** |

Cause: every `speckle()` call site (used by every grain family — far-field,
close-range, the walk deck's own aggregate) now does an extra offscreen-canvas
allocation and `drawImage` upscale pass before compositing onto the real
tile. Individually cheap, real in aggregate across ~30 call sites, and paid
once per page load, not per frame — but for a candidate that also measured
zero benefit (`docs/ground-verdict.md` §2), this is a pure regression with
nothing on the other side of the ledger.

## `acer/g-blur` — one-time cost, not independently re-timed this session

Structural argument, not a fresh measurement: every image this candidate
touches is drawn once per page load and cached forever
(`docs/GROUND_TEXTURE.md` §6, `docs/ground-pattern-map.md` §2 — "no per-
repaint cost question here at all," unlike the facade atlas which redraws on
every hour-tick). The candidate's own commit reasons from that structural
fact rather than re-timing cold load, citing the same heavy sibling-load
conditions that made `g-coarse`'s number noisy to obtain. Given the
candidate has zero measured benefit regardless (`docs/ground-verdict.md`
§1), this was not chased further.

**Not established**: an actual re-timed cold-load number for `g-blur` on a
quiet machine. If this candidate is ever revisited for a different reason,
get that number first — `g-coarse`'s "structurally one-time, so it must be
cheap" reasoning turned out to still cost 5 real seconds once actually
measured.

## `acer/g-zoomfade` — expected near-zero, not timed

The only new per-frame machinery of the three: a `pitch` listener,
throttled and quantised to 1°, pushing a multiplier into three paint
properties only when the camera's pitch actually crosses a threshold band.
Expected to be near-zero cost by construction (it does nothing on 359 of
360 degrees of camera orientation and nothing at all below 66° pitch) but
was never put in front of `perf.mjs` or a frame-timing harness this session.

**Not established**: an actual number. Reasoned-but-unmeasured, flagged as
such in the candidate's own verdict doc (`docs/g-zoomfade-verdict.md`,
closing section).

## Production impact of this round

**Zero.** All three branches are parked, unmerged, pushed to origin for the
record. `origin/main` (588f383) is unchanged by this round; nothing here
needs a production re-verification because nothing here reaches production.
