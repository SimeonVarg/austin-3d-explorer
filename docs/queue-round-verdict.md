# The twelve-lane QUEUE round, judged — combined branch, per-lane spot checks, blind looks

Judge pass over `acer/q-audit`, `q-towerglow`, `q-windowflicker`, `q-slidein`,
`q-horizontilt`, `q-flythrough`, `q-chrome`, `q-downtown`, `q-dkr`,
`q-buildings`, `q-roofs`, `q-ground`. Ports 8613 (combined build) and 8614
(bare `origin/main`, temp worktree, removed after use). One headless Chrome
instance at a time, killed after each use; both ports confirmed free at the
end (no LISTENING socket on either).

## Which branches exist

**11 of 12 pushed something. `acer/q-buildings` does not exist on origin** —
no branch, no commits, nothing to judge. No sibling worktree for it survived
either, consistent with a full refusal that made no changes at all. Treat it
as "did not report," not as "reported nothing wrong."

## The combined branch

Built locally (`acer/q-combined-verdict`, not pushed) by merging all 11
existing branches into `origin/main` (`a80502c`) one at a time. **Zero git
conflicts across all 11 merges** — every merge was clean, including the two
that touch code. Final diff vs `origin/main`: **100 files, +2078/-57, and
only two of those files are code**: `js/app.js` (+19/-6, `acer/q-flythrough`)
and `js/ground.js` (+130, `acer/q-ground`). `acer/q-ground` also rewrites
`QUEUE.md` (its own three items marked closed) — no other branch touches
`QUEUE.md`, so no docs conflict either. Everything else across all 11
branches is screenshots and `docs/*.md` — **9 of the 11 are verification-only
refusals or "already fixed" corrections with no code change**, which is why
conflict risk here was structurally low going in.

**No fighting interaction found.** The two code changes touch unrelated
subsystems (camera pose vs. ground-texture atlas) with no file overlap. A
wide cruise-campus pose shot on combined vs. bare main is visually identical
at the byte level a human would notice (ground-texture blur is a ~0.3pp
motion effect, invisible in a still at this altitude — expected, not a
failure to find something). `harness-drift.mjs` passes on the combined tree
(30/30 scripts, index.html and _harness.html still match).

## Gate 1 — nothing regressed

- **Plain load** (`?drift=0`, combined build): zero console errors, zero page
  errors, OSM attribution (`OpenFreeMap © OpenMapTiles Data from
  OpenStreetMap`) visible.
- **Both reel shots**, driven live on the combined build, zero console errors
  on either:
  - `?autopilot=1&preset=cinematic&drift=0` — flies the campus path; at 5 s
    the Tower and downtown skyline are both in frame, golden hour, no error.
  - `?sliderdemo=1&preset=cinematic&drift=0` — parks on campus; at 20 s the
    scene is full night, Tower lit, knob at the moon icon.
  - **Confirmed by reading the code, not just screenshotting**: `revealAndIntro()`
    in `js/app.js` sets `doIntro = !doTour && !doSlider && intro !== '0'`, and
    `doTour` is true for `autopilot=1`. So `q-flythrough`'s `INTRO.end` change
    (the only code touching the reel-shot code path's file) **cannot affect
    either reel shot** — the intro flight it edits never runs when either flag
    is set.
- **UT Tower crown at z16.25** (`tower-check.mjs`, 16/18 pass): the crown
  passes ("far narrower than the shaft it sits on, 6.45x", "steps out at
  least twice below the cap") on **both** the combined build and bare
  `origin/main` — **identical pass/fail profile, identical numbers to three
  decimal places** on both builds (verified by running the same script
  against both servers). The 2 fails (`belfry width/shaft width`,
  `cap width/shaft width`) are a pre-existing calibration mismatch in the
  test's own expected ratios, not a regression from this round — same exact
  `got` values on main. Not a repeat of the "crown deleted by the tile
  simplifier" bug (that was fixed separately, `5b6a92b`, unrelated to this
  round).
- **Walking mode at 1.7 m**: `js/controls.js` and `js/collision.js` are
  **byte-identical** between combined and `origin/main` (empty `git diff`) —
  no branch in this round touches either file. `ALT_MIN = 1.7` confirmed
  unchanged by direct read. **Not independently re-driven with a live walk**
  (the 12-minute `walk.mjs` run was skipped as disproportionate to a file
  nothing in this round touches — rigor matched to risk, not skipped
  silently).

## Gate 2 — spot-checking each lane's headline claim myself

**`acer/q-ground` (code change) — re-measured independently, not just read.**
Isolated `js/ground.js` with a swap-in/swap-out test (their own method):
combined's file scores **3.00% crawl**, `origin/main`'s file scores **3.34%**
at the corrected `street-drag` pose (`shimmer.mjs`, 9-frame translate sweep) —
my own numbers, run fresh, land within 0.01pp of the branch's own claimed
3.33%→2.99%. Pulled `acer/g-blur`'s own before/after Speedway herringbone
pair (the branch's cited highest-risk surface) and looked at both — visually
indistinguishable, brick still reads as brick. **The fix is real, repeatable,
and small** (-0.34pp of a 3.3% total — most of the remaining crawl is window
shimmer, out of this branch's scope and correctly not claimed as fixed).

**`acer/q-flythrough` (code change) — re-shot the new and old `INTRO.end`
poses myself.** At golden hour (the branch's own before/after pose) the old
ending is a flat, generic mid-campus roofline with a small Tower — matches
the complaint verbatim ("guad buildings...whatever"). The new ending banks to
reveal the downtown skyline silhouetted behind the Tower with campus filling
the middle ground — a genuinely more striking establishing shot, confirmed
by looking, not by trusting the branch's framing of its own diff. At night
the label layout gets a little busier at the new bearing (`Robert A. Welch
Hall` / `George H.W. Bush State Office` crowd each other) — not a regression
this branch introduced, MapLibre's own collision layout doing what it does
at any bearing; worth a look if he ends up disliking the new frame, but not
a reason to hold this back.

**`acer/q-towerglow` — re-derived the shaft-base number myself**, not taken
from the commit message: `window.__towerShaftBase` on the combined build
returns `{"was":15,"now":20.2,"overlap":5.2}`, exactly matching the claim.
Close-range night screenshot: clean base-to-shaft transition, no seam, no
crush-to-black gradient, colour reads burnt-orange not red, base glow present.
H1 is genuinely already fixed.

**`acer/q-dkr`** — their own nadir screenshot shows a real tiered bowl with
aisles and seating decks, not a stepped cone. Confirms the claim.

**`acer/q-roofs`** — their own Jester overhead crop shows the diagonal
roof-facet intersection clearly, still present, correctly reproduced (not
fixed, not claimed fixed) and correctly scoped as a `bake_roofs.py` problem
outside `js/roofs.js`'s ownership.

**`q-windowflicker`, `q-horizontilt`, `q-downtown`, `q-chrome`, `q-slidein`,
`q-audit`** — read in full, not spot-shot individually given the time budget:
all cite specific mechanisms, debug hooks, or prior commits (`f0a8fdc`,
`PR #125`, `HANDOFF #74`, `PR #128`/`#136`) rather than assertion, and all are
internally consistent with what Gate 1/3 independently found on the same
combined build. No red flags. **This is the one place I matched rigor to
risk rather than re-deriving everything**: these are pure verification
passes with zero code change, so a wrong "already fixed" costs a stale
QUEUE.md line, not a shipped defect.

## Gate 3 — judged blind

Two pairs looked at without the mapping in view first:

1. **Cruise-campus wide shot, combined vs. bare main.** No preference — the
   two are indistinguishable at this altitude, as expected (the only
   pixel-level code change, ground blur, is a motion effect and this is a
   still). Correctly predicts nothing to see here.
2. **`INTRO.end`, old bearing 2 vs. new bearing 202, golden hour.** Preferred
   the new frame before checking which was which — the downtown skyline
   reveal reads as intentional and cinematic, the old frame reads as "generic
   dense campus roof," which is the same word the original complaint used.
   Blind call agrees with the branch's own claim here.

## What this did not establish

- Live-drove neither `walk.mjs` (12 min) nor a full `movement.mjs`/
  `collision.mjs` pass — justified above by zero diff in the files they
  guard, not verified by running them.
- Did not independently re-shoot `q-windowflicker`, `q-horizontilt`,
  `q-downtown`, `q-chrome`, or `q-slidein`'s claims pixel-for-pixel; read
  their evidence and reasoning, did not reproduce it from scratch.
- Did not run `perf.mjs`/frame-timing on the combined build — ten sibling
  browsers were active for parts of this session (their worktrees are still
  present at `wf_540ab009-56c-*`), so any number would have been contended
  and, per this repo's own rule, not worth reporting as an absolute.
- Did not investigate why `acer/q-buildings` produced nothing — worth asking
  whoever dispatched it whether it crashed or genuinely found nothing to do.
- `q-ground`'s own doc already flags: the non-ground ~2.5pp of the
  `street-drag` crawl is unattributed (probably window shimmer), and the fix
  was not run through `perf.mjs` for frame cost (structural argument only —
  draws once at load, shared kernel already paid for elsewhere).

## Ranked ship list

| branch | verdict | why |
|---|---|---|
| **`acer/q-ground`** | **merge** | Real, small, repeatable fix (-0.34pp crawl), independently re-measured by me, no regression found, eye check holds, taste values named per rule 11 (`GROUND_SOFTEN`). Also correctly closes I1/H4 in `QUEUE.md` as already-fixed. |
| **`acer/q-flythrough`** | **merge** | Confirmed harmless to both reel shots by reading the code (INTRO never runs under `autopilot`/`sliderdemo`). Blind-judged improvement over the old ending, matches the original complaint precisely. Only soft caveat is label crowding at night, not a regression. |
| `acer/q-towerglow` | merge (docs only) | Correct, re-verified independently with a fresh debug-hook read and a screenshot; QUEUE H1 should be struck. |
| `acer/q-dkr` | merge (docs only) | Correct, own screenshot confirms; QUEUE K3 should be struck. |
| `acer/q-chrome` | merge (docs only) | Consistent with everything else found this pass; QUEUE I3/K6 should be struck. |
| `acer/q-horizontilt` | merge (docs only) | Well-instrumented re-verification (pinhole-geometry prediction matched to ~1 px); QUEUE H3 should be struck. |
| `acer/q-windowflicker` | merge (docs only) | Traces the MapLibre-internal mechanism to source; correctly leaves the item open in spirit (tile-zoom flip still happens, just no longer visible) rather than over-claiming a fix. |
| `acer/q-audit` | merge (docs only) | Fixes five more copies of the exact buried-camera pose bug across sibling pose files; pure risk-reduction for future measurement rounds. |
| `acer/q-downtown` | merge (docs only) | Honest refusal — measured, confirmed no single-file fix exists without breaking campus's own correct grade. Correctly declines rather than forcing a bad fix. |
| `acer/q-roofs` | merge (docs only) | Honest scoping refusal — reproduces and quantifies, correctly identifies the fix belongs in `bake_roofs.py`, not this lane's file. |
| `acer/q-slidein` | merge (docs only) | Honest "could not get a clean read" on Z1 under contention, correctly declined to guess; smear correction (not two duplicate towers) is a real finding for whoever picks Z1 back up. |
| `acer/q-buildings` | **drop / re-dispatch** | Does not exist. No branch, no report, no evidence of what happened. |

**All 11 existing branches are ship-worthy as documentation/verification
commits; two of them (`q-ground`, `q-flythrough`) also carry the only
substantive code in the round and both hold up under independent
re-measurement.** Recommended merge order: the two code branches first
(either order — they don't touch the same file), then the 9 docs-only
branches in any order, since none of them collide with each other or with
`QUEUE.md` except `q-ground`'s own edit to it.
