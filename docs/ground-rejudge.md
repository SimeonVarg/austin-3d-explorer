# Ground crawl re-judged, plus I1 and H4 checked against the live code

Three jobs, one file (`js/ground.js`). Branch `acer/q-ground`, port 8612.

## 1. The GROUND CRAWL re-judgment — the "0.00pp, refused" verdict is overturned

`docs/ground-verdict.md`, `docs/ground-cost.md` and the QUEUE.md GROUND CRAWL
entry all rest on a `street-drag` pose with **the camera buried inside a
surface** (`a80502c`, confirmed by `docs/pose-audit.md`: hiding all 55
ground/road layers at the old pose changed only 2.4% of pixels vs. 16% at the
corrected one, and the before/after frames were visually identical). Every
number attributed to that pose — the "38.27%, ten times worse than anything
else in the city" headline, and all three candidates' "0.00pp at every
radius" — was measured at a pose where almost nothing ground-related was
actually on screen. **That verdict is void, not confirmed.**

Re-measured at the corrected pose (`scripts/verify/shimmer-poses.json`'s
current `street-drag`: center `[-97.74155, 30.2876]`, zoom 17.8, pitch 70,
bearing 180 — subject-in-frame confirmed by eye, `shots/q/ground/
baseline-street-drag.png`: Guadalupe, CAVA/Urban Outfitters/Starbucks
shopfronts, the Tower, all legible), whole-frame translate crawl
(`shimmer.mjs`, 9 frames, 3 m travel):

| build | crawl% | Δ vs `origin/main` | repeat run | noise floor |
|---|---|---|---|---|
| `origin/main` (HEAD, no candidate) | **3.33%** | — | 3.33% (byte-identical) | 0.00pp — this instrument is fully deterministic at this pose (headless swiftshader, seeded canvas RNG, fixed camera steps) |
| `acer/g-blur`'s `js/ground.js` | **2.99%** | **-0.34pp** | 2.99% (byte-identical) | 0.00pp |
| `acer/g-coarse`'s `js/ground.js` | **3.04–3.06%** | **-0.27 to -0.29pp** | 3.04% vs 3.06% | ~0.02pp — the one candidate with any run-to-run wobble |
| `acer/g-zoomfade`'s `js/ground.js` | **3.09%** | **-0.24pp** | 3.09% (byte-identical) | 0.00pp |

Every number above is the swap-in-one-file test: `git checkout <branch> --
js/ground.js`, measure, `git checkout HEAD -- js/ground.js`, restore — the
rest of the tree (including the corrected pose file) stays on `origin/main`
throughout, so this isolates each candidate's own code change.

**The headline reversal: none of these are zero any more.** All three move
the number, repeatably, in the same direction, on the corrected pose. The
"it isn't `js/ground.js` at all" conclusion in `docs/ground-verdict.md` and
HANDOFF §171 is also corrected by this — the isolation test that produced it
was run at the same buried-camera pose:

**Re-run at the corrected pose** (own scratch harness, not `shimmer.mjs`
itself, same 9-frame translate-crawl scan; see "what this did not establish"
below for why it isn't `shimmer.mjs` verbatim): hiding every layer
`js/ground.js` owns (23 layer ids — every fill, fill-extrusion, background
and dashed line the file adds) drops crawl from **~3.1–3.4% to 2.49%**
— a real ~25% reduction, confirmed visually
(`shots/q/ground/isolate-hide0.png` vs `isolate-hide1.png`: the second frame
shows every road/path/texture surface fall back to flat basemap sand, streets
and buildings otherwise untouched). So `js/ground.js` **does** own a real
slice of the crawl at this pose (roughly a quarter of it) — not zero, and
not the majority either. The rest is something else in frame (most likely
window/wall shimmer on the visible facades, not measured further here).

### Verdict: merge `g-blur`'s table, reject the other two

**`g-blur`'s `GROUND_SOFTEN` table and the four `blurWrap` hooks are ported
into this branch's `js/ground.js`** (same diff `acer/g-blur` built,
byte-for-byte — `js/ground.js` was identical between that branch's base
commit and `origin/main`, so it applied clean). Reasoning:

- **Largest effect of the three** (-0.34pp vs -0.27/-0.29pp and -0.24pp),
  with the shallowest downside: it draws each pattern image **once at load**
  (`ground-pattern-map.md` §2 — these atlases carry no time-of-day colour, so
  there is no per-repaint cost the way the facade atlas has one), using the
  same `PatternLowpass.blurWrap` kernel six other files already ship.
- **`g-coarse` is dominated, not just weaker.** Smaller crawl reduction AND a
  real, previously-measured cost: **+27% cold load** (19.4s → 24.8s) for a
  benefit smaller than `g-blur`'s. No reason to prefer it over `g-blur` at
  any radius.
- **`g-zoomfade` is dominated too.** Smallest effect of the three, and it
  trades a static one-time draw for a live `map.on('pitch', ...)` listener
  that recomputes and re-sets paint properties on every pitch change past
  66° — more moving parts for less benefit. No regression was found in it,
  but there's no reason to carry the extra mechanism when `g-blur` already
  covers more ground more simply.
- **The eye check, re-run against the corrected pose's own risk case.**
  `ground-pattern-map.md` §4/§7 flagged the Speedway herringbone as the
  highest-risk surface (its own comment: the brick joint is already at the
  1-texel Nyquist floor, "the smallest thing that can read at all" — no
  headroom for a blur to erase it without visible damage). `g-blur`'s own
  before/after eye-level pair at that exact spot
  (`git show origin/acer/g-blur:shots/shimmer/ground/blur/
  before-r0-speedway-eyelevel.png` vs `after-shipped-speedway-eyelevel.png`,
  pulled and viewed for this pass) are visually indistinguishable — the
  herringbone still reads as laid brick, not mush. The predicted highest-risk
  case survives.

`acer/g-blur`, `acer/g-coarse`, `acer/g-zoomfade` can be deleted — their code
is either ported (`g-blur`) or superseded by it (`g-coarse`, `g-zoomfade`).

### What this section did NOT establish

- What the remaining ~2.5% (non-`js/ground.js`) crawl at this pose actually
  is — not attributed to a specific file or layer, only shown to survive
  `js/ground.js` being entirely hidden.
- Frame-render cost of the shipped `g-blur` table at cruise/flying framerate
  — not put through `perf.mjs`. The structural argument (draws once at load,
  same kernel six other files already ship for free) was judged sufficient
  given the size of this change; a full timing pass was not run.
- Crawl at any pose other than `street-drag` and its isolation variant —
  the other 8 poses in `shimmer-poses.json` were not re-swept for this job.
- Whether `g-coarse` or `g-zoomfade` would look any different from `g-blur`
  in a still frame beyond the one Speedway pair checked — not compared
  directly against each other visually, only against `origin/main`.
- The isolation harness above is a purpose-built scratch script (not part of
  the owned `scripts/verify/` suite — this lane's write scope is
  `js/ground.js`/`QUEUE.md`/`docs/ground-rejudge.md`/`shots/q/ground/`, not
  new `.mjs` tooling in a directory other lanes are also editing), so its
  3.36%/3.09% baseline readings differ slightly (±0.3pp) from `shimmer.mjs`'s
  own 3.33% — same qualitative story, not the same instrument, not claimed
  to be.

## 2. QUEUE I1 — "sidewalks look like bathroom tiles" — ALREADY FIXED, verified

This was fixed **2026-08-04** on `PR #129` (`acer/sidewalk-scoring`, merged
`7c0ac8a`, HANDOFF §67) and independently confirmed "Landed" against real
frames in a later session (HANDOFF, the `day-the-drag` 4x table: "cross-joints
run perpendicular to the walking direction along each kerb. It reads as a
sidewalk, not as one tiled floor"). **QUEUE.md's I1 entry was never updated
to say so** — it still reads as an open third attempt. It is not; the code on
`origin/main` right now is that third attempt, and it works.

What's actually in `js/ground.js` (`pathSlabAngles`/`pathSlabPhase` etc.,
lines 197–266): a per-feature `fill-extrusion-pattern` keyed on a baked
per-region direction (`o`, from `scripts/bake_ground.py`'s
`walk_direction_runs`), using eight integer-vector angles chosen specifically
so the bar pattern tiles with **zero phase jump at any tile edge** (the
`phase = frac((a·x+b·y)·k/T)` argument in the file's own comment is exact,
not approximate, for any integer a/b/k). That is the actual fix for "one
huge tile floor the sidewalks reveal a portion of" — the joints are baked to
follow each walk's own direction instead of a single world-anchored grid.

Re-checked this pass, not just taken on the old record: read the relevant
`js/ground.js` block in full, confirmed the bake wiring exists
(`scripts/bake_ground.py`'s `walk_direction_runs`/`score_walks`), and took
fresh screenshots — `shots/q/ground/i1-southmall-eyelevel-baseline.png`,
`i1-southmall-along.png` (looking down the walk, South Mall),
`i1-speedway-eyelevel-baseline.png` (the herringbone, a different pattern
family but same "does it look like laid units, not a tiled floor" question).
None show a single continuous grid running through unrelated walks the way
the original bug report and `shots/i1-before/` (from PR #129's own before
shots) did.

**Recommend: mark I1 done in QUEUE.md** (done below). No code change made —
there was nothing left to fix.

### What this did NOT establish

- Did not re-photograph every walk orientation in the city (only South Mall
  and Speedway this pass) — a corner case elsewhere is possible, just not
  found.
- Did not re-run the original PR's own before/after A/B harness — relied on
  its own committed record (`shots/i1-after/curveB-crop.png` etc.) plus a
  fresh, independent look this pass, not a byte-for-byte repeat of its test.

## 3. QUEUE H4 — "asphalt bleeds into Speedway" — ALSO ALREADY FIXED, verified

Also older than this session: commit `92860e9` ("Horizon follows the bank; a
pedestrian mall is not a road", **2026-08-04**, already on `origin/main`)
added the exact fix the QUEUE H4 entry was speculating about. Quoting its own
comment in `scripts/bake_ground.py` (§"a mall is not a road"), which opens
with the literal complaint: *"some asphalt roads bleed into speedway"* — OSM
carries East 26th/23rd as stubs that run past the kerb onto the brick because
the mall severs them, and the ground rank ladder's cross-band rule ran only
one direction (carriageway cuts path). The fix is two-sided and both halves
are wired into the live pipeline, confirmed by reading the call sites, not
just the comment:

- `resolve_ground_conflicts()` (line ~2937): the carriageway-cuts-path rule
  is skipped when the path is `is_pedestrian_mall()` — Speedway keeps its
  full brick footprint instead of being notched by the road stub.
- `widen_roads(..., keep_out=pedestrian_mall_union(feats, stats))` (line
  3264): the carriageway polygon itself is clipped to exclude the mall
  union, so the asphalt is never drawn on top of the brick in the first
  place. Both halves are needed (the file's own comment says so) and both
  are present.

`data/ground.geojson` has been rebaked since this commit (later commits
`9369e6a`, `a5a3f68` both touch it), so this isn't a fix sitting unbaked in
the script. Confirmed on screen: `shots/q/ground/h4-speedway-26th.png`, a
nadir view of the exact East 26th crossing the bake's own comment cites —
clean herringbone brick corridor, no grey rectangle stub on it.

**Recommend: mark H4 done in QUEUE.md** (done below). No code change made.

### What this did NOT establish

- Only one of the two crossings the source comment names (26th) was
  re-photographed; the 23rd St. attempt used a guessed coordinate that
  missed the corridor entirely (`shots/q/ground/` does not carry that dead
  frame — deleted rather than kept as a false negative) and was not
  re-attempted.
- Did not check the other 6 of "EIGHT features carry `u:'pedestrian'` in the
  whole city" the source comment mentions — only Speedway, the one the
  complaint named.

## Branch / port bookkeeping

Branch `acer/q-ground`, cut from `origin/main` (`a80502c`). Server port 8612,
confirmed free before starting, will be confirmed free again at the end of
this pass. One headless Chrome instance used throughout, killed at the end.
`scripts/verify/node_modules` was empty in this fresh worktree — copied in
from the main checkout's own `scripts/verify/node_modules` (per this
repo's own README: "npm install is not optional and its absence is
invisible").
