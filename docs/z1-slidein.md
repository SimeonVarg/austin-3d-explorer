# Z1 — the downtown horizon slide-in, SETTLED (`acer/r-slidein`) then FIXED (`acer/f-z1`), 2026-08-22

> **The fix landed the same day — see "The fix" at the bottom of this file.**
> The reel flags now hold the veil on the intro's own source gate with a hard
> 24 s ceiling; measured before/after in `shots/f/z1/`. Everything below this
> line is the evidence pass that found the mechanism, kept as written.

*"buildings in downtown in shot A start like sliding in from the horizon."*

**It is MapLibre streaming the `austin-outer` vector tile source while the
camera flies at it, and it is streaming across almost the entire flight, not
a one-time startup burst.** Confirmed two independent ways on a quiet machine
(one other lane's server on the box, not the ten-sibling contention the last
attempt hit): a timestamped tile-arrival log correlated against the camera's
own pose, and a magenta-mask layer hide. No code was changed — see "why not"
below.

## What was already known and not re-derived

`js/lod.js` is altitude-gated and drops nothing during this shot (119–216 m
against a 495 m threshold); `renderDistance: 1500` already means unlimited;
`js/app.js`'s `apPrime()` (`AP_PRIME_MS`, merged before this pass) already
steps the camera through every `AP_TOUR` waypoint once before the veil lifts,
to get MapLibre requesting the route's tiles early. All still true. This pass
answers the question that was left open: does the prewarm's own request
actually land before the buildings are needed, and if not, which layer is it.

## The timing evidence

`?autopilot=1&preset=cinematic&drift=0`, hardware GL, instrumented with a
property-setter on `window.__map` installed via `addInitScript` — so the
clock starts at navigation, before app.js's own first line runs, and no
`sourcedata` event between then and the hook firing can be missed (the same
pattern `boot.mjs` already uses for source timing). Every **first**
`isSourceLoaded=true` event for the `austin-outer` source was logged with its
tile `z/x/y`, alongside the camera's pose on every `move` event, all on one
clock. Full log: `shots/r/slidein/flight-log.json`.

```
map object assigned:  t=1019 ms
map 'load' event:     t=1820 ms
first austin-outer tile lands:  t=7915 ms   (13/1871/3373 — a coarse tile)
...18 distinct tiles total, arriving one at a time, roughly every 1-7s...
last tile of the run:           t=46213 ms  (16/14975/26981)
flight duration (AP_TOUR legs): ~45.6 s
```

**The tiles keep arriving almost to the last waypoint of the flight.** This
is not the prewarm's own burst settling late — the prewarm is capped at
`AP_PRIME_MS = 2600 ms` and by the time it ends (~t=3600ms with the ~1s
boot lead-in) precisely **zero** `austin-outer` tiles have finished loading.
The prewarm *requests* the route's tiles early (that part of the existing fix
is real and doing what it says), but the fetch+worker-tiling pipeline for
this source does not resolve any of them until ~4s after the prewarm window
has already closed, and continues resolving new ones — genuinely different
tile coordinates, not repeats — as the camera advances into new parts of the
ring for the rest of the flight.

**Caveat, stated because the instrument's own defaults are part of the
answer (CLAUDE.md rule 10):** this ran against `scripts/serve.py`
(threaded, range-request-correct — not the naive `http.server` the repo
explicitly bans), not the production CDN. The same commit that added the
prewarm already noted its own A/B was not clean for the same reason ("the
baseline is production on a CDN and the arm is a local python server, and
serve.py is the slower of the two"). The exact millisecond timings here are
therefore a local-server measurement; the **structural** finding — tiles for
this source keep landing through most of the flight, not just at the start —
does not depend on which server is serving them, only on how long the
fetch+tile pipeline takes relative to how fast the camera is asking for new
ground.

## The visual evidence — buildings visibly densify over the flight

Screenshots taken immediately after each new tile's first-load event (same
run, same clock):

- `flight-01-t7915ms.png` — the loading veil is STILL UP at the very first
  tile arrival (97% "drawing the first frame"). The first `austin-outer` tile
  lands before the visitor can see anything at all.
- `flight-07-t18977ms.png` (7 of 18 tiles loaded) — downtown is visible but
  the skyline is noticeably sparse and hazy: fewer towers, more gaps.
- `flight-10-t25012ms.png` (10 of 18) — visibly denser than frame 7, right
  after a three-tile cluster landed at t=24.3–25.0s.
- `flight-14-t38631ms.png` (14 of 18) — denser again.
- `flight-99-end.png` (all 18 loaded, long-settled) — the reference "finished"
  skyline: more towers, more colour variation, more detail than any of the
  in-flight frames.

Same pose family, same time of day, same run — the only variable across
these frames is how many `austin-outer` tiles had finished loading. That
progressive densification of the horizon skyline **is** the reported defect,
photographed.

## The layer evidence — magenta mask (HANDOFF §48)

Question: do the appearing horizon buildings actually belong to
`js/outer.js`'s layers, or could this be something else (a facade atlas
cross-fade, a basemap label, a different source)? Settled with a hide-and-diff
at a mid-flight pose (`_harness.html`, jumped to the same pose family as
`flight-10`, tiles settled/idle before either shot — `map.areTilesLoaded()`
confirmed true, not assumed):

- `shots/r/slidein/mask-01-plain.png` — plain render. Downtown skyline on the
  horizon behind the Tower, subject-in-frame confirmed by eye (not asserted
  from code).
- `shots/r/slidein/mask-02-outer-hidden.png` — every layer `js/outer.js` adds
  (`outer-3d`, `outer-tower`, `outer-tower-roof`, `outer-midrise`,
  `outer-midrise-roof`, `outer-detail`) set to `visibility: none`.

**The entire downtown skyline disappears. Nothing else in the frame moves a
pixel** — the UT Tower, campus buildings, all OSM labels (Cambridge Tower,
Moontower, Skyloft, The Castilian — all outer-ring towers by name, still
rendered as label text because MapLibre's basemap labels are a separate
source from the 3D geometry) are byte-for-byte identical between the two
shots. This is a hide-one-layer-family, diff-the-frame test, not a read of
the code — and it confirms the appearing buildings are 100% `js/outer.js`'s
downtown/outer-ring geometry, streaming as `austin-outer` vector tiles.

## Why no code change was made here

The leading candidate the queue item pointed at — MapLibre streaming tiles
into the frustum as the camera advances, not a range/LOD/culling setting —
is now confirmed, not just structurally suspected. The question the brief
asked next was whether it can be hidden from inside this lane's three owned
files (`js/outer.js`, `js/lod.js`, `js/tiles.js`). It cannot, without either
a broad or an unproven change:

- **The actual lever is a longer prewarm hold**, i.e. raising
  `AP_PRIME_MS`/changing when the veil lifts relative to `austin-outer`
  becoming loaded. Both live in `js/app.js` — the prewarm mechanism, the veil
  logic, and `reveal()` all belong to that file, not this lane's three.
  Writing a fix there is a different lane's file to touch, per CLAUDE.md's
  own lane rule ("if you need a schema change in someone else's file, write
  the request into HANDOFF.md rather than making it").
- **`js/tiles.js`'s only real lever, `TILES.maxzoom`, is shared across all
  five tiled layers** (trees, roads, outer, roofdetail, props), not scoped to
  `austin-outer`. Lowering it would trade fewer/coarser tile requests for
  `austin-outer` against a global loss of close-up geometry precision on
  every tiled layer in the app, including the ones nobody has complained
  about. That is a broad, unrelated blast radius for a Shot-A-specific
  symptom — not a fix to make on reasoning alone, and not verified here.
- **A fade-in on new tiles was considered and rejected as not real.**
  MapLibre's `<paint-property>-transition` interpolates a layer's paint value
  between two states of a style update; it does not interpolate a feature
  INTO existence when its tile simply becomes available for the first time —
  there is no "before" state to fade from. Building an actual fade (tracking
  newly-loaded tiles and ramping their opacity from a paint expression) is a
  new mechanism, not a bug fix, and this is a fixing-not-adding round.

**So: recommend to whoever owns `js/app.js` next — either raise the prewarm
hold well past the ~4-46s window measured above (expensive: it delays the
opening on the shot he records), or accept this as what a tile-streamed
skyline does at this camera speed and distance.** Both are legitimate
answers; this pass settles which mechanism it is, not which trade-off he
wants made.

## What this did NOT establish

- Not measured against production (Vercel/CDN) — local `serve.py` only, per
  the tool the repo requires. The caveat above explains why the exact
  millisecond numbers likely overstate the problem relative to production,
  while the *structural* finding (streaming spans nearly the whole flight,
  not just the start) does not depend on which server answered.
- Did not attempt a fix to `js/app.js`'s prewarm window — out of this lane's
  file ownership by the task brief.
- Did not measure frame rate — not asked for, and three sibling browsers were
  active, which this repo's own rule says makes an fps number untrustworthy.
- Did not check whether other tiled layers (trees, roads, props, roofdetail)
  show the same symptom on their own routes — out of scope for Z1, which is
  specifically Shot A's downtown horizon.

---

# The fix (2026-08-22, `acer/f-z1`)

**What changed.** `js/app.js` only. `?autopilot=1` and `?timelapse=1` used to
lift the veil on a flat 7 s timeout (`INTRO.minVeilMs`), ready or not. They now
go through the same `introGate()` + `gateHolds` poll the intro page uses —
`map.isSourceLoaded` over every `austin*` opening source including
`austin-outer`, held over two consecutive polls, because one poll is not
evidence (a source answers "loaded" before it has begun fetching; boot.mjs
measured that producing a 3× error). The reel flags get their own hard ceiling,
`AP_VEIL_MAX_MS = 24000`: a slow network must never hold the veil forever, so
past 24 s it lifts with whatever city has arrived, exactly as before. The
intro's own floor and ceiling (`INTRO.minVeilMs` / `maxVeilMs`), plain
`?tour=1`, and every `?intro=0` verify page keep their old timing to the
millisecond.

**Why the defect was intermittent, which the baseline run exposed.** On a quiet
machine MapLibre's `idle` event happens to fire before the 7 s timeout and acts
as an accidental gate — the shot was being saved by luck. Under load the
timeout wins, and `__intro.missingAtLift` reads all four sources missing:
the recorded shot opens on empty land.

**The measurement** (`shots/f/z1/z1flight.mjs`, same instrument pattern as the
evidence pass above: t0-at-navigation `sourcedata` log, first load event per
`austin-outer` tile, veil lift via MutationObserver, all on one clock; local
`scripts/serve.py`, hardware GL; sibling lanes were active on the box, so
wall-clock numbers carry that noise — the structural counts do not).

Quiet machine, `?autopilot=1`, one rep each arm — the no-regression check:

| run | veil lift | reason | austin-outer tiles behind veil | last arrival after lift |
|---|---|---|---|---|
| before | 10.3 s | idle | 17/39 | +38.0 s |
| after | 9.2 s | idle | 17/39 | +38.2 s |

Identical behaviour, identical opening. An ordinary fast load got no slower.

Loaded machine (CPU throttled 2×, the state Simeon originally reported the
defect from — quoted per CLAUDE.md rule 10; the 4× the perf suite uses
wedged the whole page past its own trustworthiness rule and was discarded),
two interleaved reps each arm:

| run | veil lift | reason | tiles behind veil | missing at lift |
|---|---|---|---|---|
| before2x | 26.1 s | **timeout** | **0**/27 | all four sources |
| before2x-r2 | 13.6 s | **timeout** | **0**/38 | all four sources |
| after2x | 16.6 s | idle | **17**/38 | none |
| after2x-r2 | 18.5 s | idle | **17**/38 | none |

Both baseline reps lift the veil with ZERO `austin-outer` tiles finished.
`before2x-f00s.png` photographs what that means mid-shot: empty flat land
behind the Tower where downtown should be — the reported defect exactly.
`after2x-f00s.png` / `after2x-r2-f00s.png`: full skyline standing on the
opening frame, both reps. Frames read at 0/2/10 s of the flight show no
materialisation in either after rep.

**The honest cost.** Comparing the clean pair (before2x-r2 vs after2x-r2), the
gate held the veil ~5 s longer under 2× load; on the quiet machine it cost
nothing (−1.1 s, run noise). Worst case is bounded at 24 s by design.

**What did NOT move, on purpose.** The claim to beat was "last new tile at
t=46213 ms of the flight" — and post-fix, stragglers still land ~+38 s into
the flight (21–22 tiles after lift in every arm, quiet or loaded). That
streaming cannot be removed from `js/app.js`: those tiles belong to viewports
the camera has not reached yet, and holding the veil for them would mean a
~46 s veil. What changed is what the straggler arrivals look like: with the
opening viewport's tiles — including the coarse z13/z14 ancestors that carry
the whole downtown massing — resident before the veil lifts, a late z16–18
arrival refines a building that is already standing instead of materialising
it from empty ground. Read the after frames: the skyline is complete from
frame one in every post-fix run.

**Also verified:** `?timelapse=1` gates the same way (13/19 tiles behind
veil, skyline standing at frame left of its opening); Shot A still opens
exactly at AP_TOUR waypoint 0 (pose read back: −97.7381/30.2913, z16.25,
pitch 69, bearing 199.5), flies forward-only (lat strictly decreasing across
all sampled frames, bearing within the authored 185–200 band), and drives the
joystick nub (non-empty transform at every sampled frame); plain page and
every run console-error free.
