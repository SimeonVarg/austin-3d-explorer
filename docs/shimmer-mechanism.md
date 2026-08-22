# The window shimmer — mechanism, proved

**Status: CONFIRMED. Texture minification/aliasing of `fill-extrusion-pattern`
under linear filtering with no mipmaps, exactly as `docs/shimmer-brief.md`'s
leading hypothesis stated.** All three predictions passed; the renderScale
question is settled honestly below.

**Housekeeping note, read first.** `docs/facade-atlas-map.md` and
`docs/pattern-sampling.md` — the two sibling docs this task was told to read
first — do not exist anywhere in this repo's history (`git log --all`) or in
any other worktree on this machine, and `origin/main` was at my HEAD
(`657482b`) the whole time, so nothing landed mid-run either. I proceeded
without them. Also worth knowing: **this mechanism was already proved once,
2026-08-01**, commit `61a96a5` ("The windows crawl because the pattern is
sharper than the screen can hold"), which built `scripts/verify/shimmer.mjs`
itself and shipped a partial fix (`window.FACADE_SOFTEN`, still live in
`js/facades.js`). A second commit (`f0a8fdc` / PR #126) then built the
two-tier mip chain (`TIERS`, also still live) that is exactly recommendation
#2 from the brief. `shimmer-brief.md` doesn't cite either commit, and the
sibling that built `shimmer-aba-prototype.mjs` this week was unaware
`shimmer.mjs` already existed and does the same job better (9-frame temporal
non-monotonicity vs. its 3-frame absolute-threshold ABA). **I used the
existing `shimmer.mjs`, per the instruction to use the meter rather than
invent one.** The finding below is a fresh, independent re-measurement on
today's code, not a repeat of the old numbers — and it explains why the
citywide defect Simeon is now reporting exists despite a fix landing three
weeks ago: the fix is real but partial, by its own admission (see Recommendation).

## Setup

Server on :8502 (`python scripts/serve.py 8502`), `VERIFY_URL` pointed at it,
`scripts/verify/shimmer.mjs` run headless/SwiftShader (its own default — this
is a pixel-correctness measurement, not timing, so that's the right backend
per `chrome.mjs`'s own rule). All poses `?intro=0&drift=0`,
`cancelGraphicsAutoDetect()` called before every sweep, veil-safe (shimmer.mjs
waits on `isStyleLoaded` + source-loaded + a settle before frame 0). One
browser at a time, `launch()`-wrapped, watchdog intact, all runs exited 0.

**Machine load, stated plainly:** heavy throughout — 26-28 node+chrome
processes from sibling lanes at peak, confirmed via `tasklist`. Individual
poses that should take ~10-20s idle sometimes took 1-3 minutes. This affects
wall-clock only: `shimmer.mjs`'s numbers are deterministic pixel counts on a
software rasterizer, not frame timing, so the load does not compromise
correctness of any number below — only how long it took to get them.

New shots files (mine, in `scripts/verify/`): `shots-mech-zoom.json`,
`shots-mech-pitch.json`, `shots-mech-std.json`, `shots-mech-rs.json`. Masks in
`shots/shimmer/mech/`.

## Prediction 1 — flicker scales with minification

Two independent camera axes were swept, both over the same ground point.

### Zoom/altitude ladder (translate/WASD mode, pitch 68, bearing 200, fixed)

| zoom | crawl % | moved % | crawl/moved |
|---|---|---|---|
| 15.5 | 2.19 | 37.0 | 0.059 |
| 16.0 | 2.91 | 42.2 | 0.069 |
| 16.5 | 3.41 | 43.5 | 0.078 |
| **17.0** | **7.90** | 48.3 | 0.164 |
| 17.5 | 8.37 | 51.7 | 0.162 |
| 18.0 | 21.27 | 55.6 | 0.383 |

Monotonic, both in raw crawl% and in crawl-as-a-share-of-moved-pixels (rules
out "more pixels moved = more noise" as the explanation — the *fraction* of
moving pixels that flicker also climbs 6.5x). The jump at z17.0 lands exactly
on `TIERS`' own `minZoom:17` boundary in `js/facades.js` — the far
(half-resolution, decimated) tier hands off to the near (full-resolution)
tier right there, and the full-res tier is more alias-prone by construction.
This is not a coincidence I'm inferring; it's the mip chain's own documented
switch point, and the data lands on it to the tenth of a zoom level.

Masks (`shots/shimmer/mech/zoom-z1*.png`) show magenta landing precisely on
window rows at z16.5-18.0, and more diffusely (roads/ground included — see
caveat below) at z15.5.

### Pitch ladder (translate mode, zoom 17.0, bearing 200, fixed)

| pitch | crawl % | moved % |
|---|---|---|
| 40 | 12.67 | 57.4 |
| 50 | 12.21 | 59.2 |
| 60 | 10.24 | 55.0 |
| 70 | 7.11 | 46.1 |
| 78 | 5.70 | 41.6 |

Clean monotonic *decrease* as pitch steepens toward the horizon. This is the
same physics from the other direction: a shallow pitch (near-nadir) views a
vertical wall almost edge-on — extreme foreshortening, maximum minification.
A pitch near the horizon views the same wall closer to face-on — minimum
foreshortening, least minification. This is also *why* the brief's own
zfight.mjs history found nothing stepping zoom alone but found the defect
immediately stepping bearing/position: for this app's **screen-locked**
pattern (`TIER_CSS` fixed CSS px per repeat, true at every camera zoom by
design — see `js/facades.js`'s own header), a purely frontal wall's
minification ratio is tier-constant, so raw zoom barely moves it. It's
oblique **view angle** — pitch, bearing, and position across a wide wall —
that drives minification here. My zoom ladder used translate mode at fixed
angle, which both crosses the tier boundary and changes angle-to-buildings
across the wide FOV as the camera approaches; that's why it isn't flat the
way pure zoom-stepping was.

**Both axes, independently, monotonic, in the direction minification
predicts. Prediction 1 confirmed.**

## Prediction 2 — band-limiting the source reduces it

Three matched poses, one browser session per arm, `SHIM_SOFTEN=1.0
SHIM_SOFTEN_R=6` (a literal 13-texel box override, superseding the tiers'
own smaller built-in softening):

| pose | pattern ON | soften r6/a1.0 | pattern OFF (floor) | soften recovers |
|---|---|---|---|---|
| bme-near | 8.57% | 4.00% | 3.83% | 96% |
| biolab-near | 7.28% | 3.37% | 3.08% | 93% |
| waggener-n | 9.96% | 5.98% | 4.99% | 84% |

Strong, aggressive band-limiting drives crawl to within ~0.2-1.0 points of the
pattern-off floor at every pose — recovering 84-96% of the available
headroom. (This is a stronger recovery than the Aug 1 investigation's own
"about a third," because that measurement compared the *tier-relative*
default soften; this sweep overrides `SOFTEN.RADIUS`/`SOFTEN.AMOUNT`
per-family with a literal, aggressive texel radius via the env knobs
`shimmer.mjs` already exposes for exactly this purpose.)

`shots/shimmer/mech/soften-r6a1-bme-near.png` is visually near-identical to
the pattern-off control shot — same clean walls, same residual clusters on
labels and roof edges.

**Prediction 2 confirmed.**

## Prediction 3 — a face with no pattern should not flicker (control)

`SHIM_PATTERN=0` strips `fill-extrusion-pattern` on all nine wall layers and
paints the baked flat colour instead. Same three translate poses:

| pose | pattern ON | pattern OFF |
|---|---|---|
| bme-near | 8.57% | 3.83% |
| biolab-near | 7.28% | 3.08% |
| waggener-n | 9.96% | 4.99% |

Pattern-off roughly **halves** the crawl at every pose — a large, consistent
drop, not a rounding difference. It does **not** reach zero: the mask
(`ctrl-nopattern-bme-near.png`) shows the walls themselves go completely
clean, but text labels and roof-edge antialiasing still register a small
amount of temporal non-monotonicity — expected and unrelated to this defect
(label collision jitter and geometry-edge AA are known, separate, minor
noise sources; they are not the reported symptom).

**Prediction 3 confirmed** — with one important wrinkle, reported loudly per
the instructions:

### A second, already-known defect contaminates the zoom-mode (Q/E) control

`ctrl-nopattern-bme-zoom.png` — pattern OFF, under a pure **zoom** step (Q/E,
not WASD) — is not clean. It's a huge radial swirl covering almost the
entire ground/road plane: 33.66% crawling, barely down from 40.23%
pattern-ON (a 16% relative reduction, vs. ~50% for translate mode). The
`soften` knob (which only touches the facade atlas) makes *no* difference
there either (33.64% vs. 33.66% — 0.02 points, noise). This is **not** a new
defect I'm claiming to have found: `js/ground.js` already documents it in
its own comments (lines ~269, ~894, ~933) — roads and paths use a *separate*
`fill-pattern` (not `fill-extrusion-pattern`), and it's tile-anchored, so
"fill-pattern resets at every integer zoom and a countable period pops."
`scripts/verify/pattern-scale.mjs` and `docs/GROUND_TEXTURE.md` already track
this. I'm flagging it because it explains why the zoom-mode number in the
control looks like a weak confirmation — it isn't weak, it's just measuring
two different bugs at once. **Translate mode (WASD) — the actual reported
symptom ("pressing wasd has it glitch") — does not show this ground swirl at
anywhere near that severity**, so the facade-pattern attribution for the
reported defect stands on the translate-mode numbers above, cleanly.

## The renderScale question, settled honestly

Same three poses, one clean A/B, `SHIM_SCALE` as the only variable (the
native WebGL canvas resizes: 1440x900 -> 2880x1800, confirmed in the
CONFIG echo):

| pose | renderScale 1.0 | renderScale 2.0 | delta |
|---|---|---|---|
| bme-near | 8.57% | 8.35% | -0.22 |
| biolab-near | 7.28% | 7.16% | -0.12 |
| waggener-n | 9.96% | 9.77% | -0.19 |

**Flat to very slightly down at every pose — not up.** The brief's own
caveat was right to flag the old reading as suspicious: `shimmer.mjs`'s
meter is a *relative* measure (a per-pixel amplitude floor plus sign-change
counting on luma, scale-invariant by construction), unlike the old
`shimmer-aba-prototype.mjs`'s *absolute* 0-255 channel-delta thresholds,
which are exactly the kind of metric that breaks across a doubled
framebuffer (a fixed absolute threshold means something different at 4x the
pixel count). **Verdict: the "renderScale made it worse" reading in the
brief was a metric artifact of the old prototype, not a real effect.**
Supersampling is not a lever on this defect in either direction — it's not
a fix, but it's also not something to avoid on flicker grounds.

One caveat worth stating rather than hiding: `shimmer.mjs` reads the raw
WebGL backbuffer via `drawImage(canvas,...)` onto a same-size 2D canvas
before scoring — at renderScale 2.0 that's the native 2880x1800 buffer,
*before* the compositor's own downscale to the 1440x900 CSS size a real
viewer sees. So this measures "does supersampling itself introduce more
texture aliasing," which it answers (no). It does not directly measure
whether the final on-screen picture is a little quieter after the browser's
own downscale (a box-filter-like operation, which would plausibly help
further) — that's a smaller, separate question this run doesn't need to
answer since supersampling is not being recommended as the fix below.

## Ranked recommendation

1. **Ship the two-tier zoom-stepped pattern that already exists (`TIERS` in
   `js/facades.js`, PR #126) further down the zoom range, and/or add a third,
   softer tier for the steepest/closest cases.** This is recommendation #2
   from the brief, and the zoom ladder shows it is already doing real work —
   the far tier (z<17) sits at 2-3%, the near tier at 8-21% — but the near
   tier's own upper end (z18, pitch-40-50 equivalent obliqueness) is still
   high. The mip chain is proven to be the right *shape* of fix; it just
   doesn't yet cover the worst-case near/oblique corner. Lowest cost, because
   the machinery (decimate, per-tier `soften`, `paintTiers`) is built,
   tested, and live — this is tuning `TIERS`/`SOFTEN`, not new architecture.

2. **Turn up `SOFTEN` (the existing per-family box-blur knob,
   `window.FACADE_SOFTEN`) more aggressively than its current defaults.**
   Prediction 2's measurement (r6/a1.0 recovering 84-96% of the available
   on/off headroom) is a *stronger* result than the Aug 1 investigation's own
   "about a third," which was measured against the tier-relative default,
   not an aggressive override. The current default (`tier.soften = 0.75` on
   the near tier, `FAMILY` multipliers 0.5-1.2, nothing on the far tier) is
   conservative. Raising it — especially on `tg` (curtain-wall towers,
   `FAMILY.tg = 1.2`, exempt from the pier/spandrel minimum, the worst family
   by construction and visibly the heaviest cluster in every zoom-ladder
   mask) — is a one-line-per-family change with an existing calibration
   instrument (`shimmer.mjs`'s own `SHIM_SOFTEN`/`SHIM_SOFTEN_R` sweep, and
   its wrap-safe box blur already exists in `softenTile`). Cost: a taste
   trade against sharpness up close, same one Aug 1 already wrote up — but
   the existing knob has more headroom than it's currently using.

3. **Fade the pattern toward flat wall colour with distance/zoom** (brief's
   #3) — not measured directly here, but the control test (prediction 3)
   shows the floor this converges toward: ~3-5% crawl (labels + edge AA),
   essentially the same floor aggressive softening (#2) already reaches. So
   this buys little over #2 for the extra implementation cost of a
   `["interpolate",...]` fade wired through the existing colour fallback
   path, and would fight the "real windows should read up close" goal harder
   than a mip tier does. Rank it behind #1/#2 unless #2's sharpness trade
   turns out to be unacceptable at the pixel-floor tuning session.

**Do not pursue:** MSAA (already ruled out in the brief, and the codebase's
own comments confirm crawl went *up* under 4x MSAA — it antialiases geometry
edges, not texture interiors); renderScale/supersampling (flat, settled
above — not a lever); anything touching z-fighting or depth precision (24-bit
depth here, ruled out in the brief and independently by this file's own
`js/facades.js` comments).

**Separately, flag to the build lanes but out of scope for this ticket:**
the ground/road `fill-pattern` zoom-aliasing defect surfaced by the
zoom-mode control (see Prediction 3) is real, large, and already tracked in
`docs/GROUND_TEXTURE.md` / `scripts/verify/pattern-scale.mjs`. It is a
different bug on a different rendering path (`fill-pattern` on
`js/ground.js`'s road/path layers, not `fill-extrusion-pattern` on
building walls) and needs its own fix, not a side effect of anything above.

## What this did NOT establish

- Did not measure the two sibling docs' own proposed formula for
  texels-per-screen-pixel (they don't exist in the repo — see the
  housekeeping note at the top); the zoom/pitch ladders above are an
  independently-derived, empirically-validated substitute, not a
  reproduction of a formula I never saw.
- Did not sweep bearing as its own axis (translate mode at fixed bearing
  already covers "angle changes as you approach across a wide wall," and the
  brief's own zfight.mjs history already established bearing/position finds
  the defect where zoom alone does not — not re-litigated here).
- Did not measure whether the renderScale 2.0 buffer's eventual on-screen
  appearance (after the browser's own downscale to CSS size) crawls less
  than 1.0 — only that the native supersampled buffer itself doesn't crawl
  more. Not needed for the recommendation above, but worth knowing if
  renderScale is ever reconsidered as a lever later.
- Did not touch or edit `js/facades.js` in a way that persists — no
  temporary probe was needed since `shimmer.mjs`'s existing `SHIM_SOFTEN`/
  `SHIM_PATTERN`/`SHIM_SCALE` env-var hooks already exposed everything the
  three predictions required, in-page, without a source edit.
