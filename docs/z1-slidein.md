# Z1 — the downtown horizon slide-in, SETTLED (2026-08-22, `acer/r-slidein`)

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
