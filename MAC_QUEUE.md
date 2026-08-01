# MAC LANE — work the Acer is not touching

Written by the Acer lane 2026-08-01 so both machines can run at once without
stepping on each other. Take from the top, one item per PR, on `mac/*` branches.

**Read `CLAUDE.md` and `HANDOFF.md` first. Pull `main` before every item.**

---

## File ownership right now — do not touch these

The Acer has three open PRs. Editing any file below means a merge conflict for a
human who is not a git person, so pick a different task instead.

| File | Acer PR |
|---|---|
| `QUEUE.md`, `docs/CLOUD.md` | #34 |
| `scripts/verify/chrome.mjs`, `scripts/verify/where-time-goes.mjs` | #34 |
| `js/capitol.js` | #35 |
| `scripts/verify/payload.mjs`, `scripts/verify/capitol-merge.mjs` | #35 |
| `scripts/reseat_authored_roofs.py`, `data/roofs.geojson` | #36 |

Everything else is fair game. If you need one of these, say so and take the next
item down.

---

## M1. Fix the "page is not defined" regression — 15 scripts crash instantly

**Highest value, and it blocks two other items.** Fifteen scripts in
`scripts/verify/` throw `page is not defined` before doing any work. A suite
where 15 of 187 scripts are dead teaches everyone to ignore failures, and it is
the stated blocker on wiring verification into CI.

**First, check this** — it cost the Acer a confusing half hour today:
`scripts/verify/node_modules` was **empty**, so *every* script failed with
`Cannot find package 'playwright-core'` regardless of the regression above.

```bash
cd scripts/verify && npm ci
```

If that was also the Mac's problem, say so plainly and re-triage which 15 are
genuinely broken before fixing anything — the list may be shorter than it looks.

**Then:** find the shared cause rather than patching 15 files. Almost certainly a
page-setup block that was hoisted into a helper, or a top-level `await` ordering
change, and one fix covers all of them. Fixing them individually is the failure
mode here.

---

## M2. Name the remaining 2,069 buildings

**The most visible user-facing win on either list.** 2,069 of 2,453 buildings
have no name, so most of the campus is anonymous when you fly over it.

`scripts/name_buildings.py` has already exhausted every offline source in the
repo and recovered 32. OpenStreetMap is mined dry — a different source is the
only way forward.

- Scrape UT's official building directory
  (`utdirect.utexas.edu/apps/campus/buildings`) and the Wikipedia list of UT
  buildings. Firecrawl's free tier covers the fetch (YC student deal).
- The real work is **matching directory entries to footprints** by address or
  coordinate. No tool does that for you, and a wrong match puts the wrong name on
  a landmark, which is worse than no name. Report a confidence per match and only
  write the ones you would defend.
- Write into `data/building_names.json`, which `js/app.js` already reads at load.
  **Not** into the snapshot — a re-bake would silently wipe that.
- Labels are gated at `final_height >= 12`, so names on buildings shorter than
  that will never appear. Prioritise accordingly and say how many of your matches
  are above the gate.

---

## M3. Install tippecanoe and tile the trees

**This unblocks the biggest architectural item in the project** (`QUEUE.md` item
1 — vector tiles, which is what lets the city hold more detail without a slower
load). Right now nobody can even iterate on it, because tippecanoe is not
installed on the Acer and the archive only ever builds in CI.

```bash
brew install tippecanoe
```

Then:

1. Confirm `scripts/tile.sh` runs locally and reproduces
   `data/snapshots/<latest>/austin.pmtiles` (~0.61 MB).
2. Extend `tile.sh` with a **second invocation for `data/trees.geojson`** — 9.13
   MB, the largest single file in the app, 25,341 fill-extrusion features
   carrying `base`/`h`. Add it as another tippecanoe call, not a new script.
3. **Pin the simplification knobs and prove they are neutral.** Tippecanoe
   simplifies geometry at low zooms by default. That is a visual-quality change
   hiding inside a delivery change and it is the one thing here that could make
   the city look worse. Screenshot at altitude before and after.
4. Keep `--maximum-zoom=16`. That cap is what fixed the city-wide motion flicker
   (`window.PATTERN_TILING`) and it must survive the move.

**Do not wire the app up to the archive in this PR.** That needs the enrichment
pipeline ported to Python first — see `QUEUE.md` item 1 for the three blockers.
This item is just: can we build the tiles at all, and are they lossless.

---

## M4. Verify suite on GitHub Actions, triggered from a phone

**Blocked on M1.** Do not wire broken scripts into CI.

**Read this before designing the matrix — it is measured, not assumed.** The
obvious framing is "run them all at once and the wall clock becomes the slowest
one". That is true *across machines* and false *on one machine*, and the
difference decides the whole design.

`scripts/verify/run.mjs` (Acer, PR #38) runs scripts concurrently on one box. It
buys **1.5×**, not the 4× you would expect from four jobs — because this suite
renders on the **CPU** on purpose (SwiftShader, for pixel determinism), so
concurrent runs do not overlap, they queue for the same cores. 213 s serial
became 143.7 s at three-at-a-time.

Worse, and this is the trap: **contention manufactures false failures.**
`retint.mjs` asserts the scene finishes retinting within 2500 ms. Alone it passes
5/5; three-at-a-time it FAILS, with nothing broken. `run.mjs` carries a
`SERIAL_ONLY` list for exactly this — reuse it rather than rediscovering it, and
note it is **not** just the `-perf` family.

So on Actions, put each shard **on its own runner**, where the cores really are
separate. That is where the concurrency is real. Do not put four jobs on one
runner and expect four times the throughput.

- `.github/workflows/verify.yml`, `workflow_dispatch` so it is a button in the
  GitHub mobile UI. Copy the shape of `build-data.yml`, which already carries the
  "Phone-friendly" comment.
- `ubuntu-latest`, **GitHub-hosted. Never self-hosted** — this repo is public and
  a self-hosted runner would let a stranger's pull request run code on his
  machine.
- `CHROME_PATH=/usr/bin/google-chrome`; `chrome.mjs` already probes that path.
- Serve on **8123**, `VERIFY_URL=http://127.0.0.1:8123`. The README records three
  agents once serving on 8099 from different worktrees, with requests going to
  whichever bound first.
- Matrix-shard the scripts. Check the free-plan concurrent-job cap (commonly
  cited as 20) before designing a 40-way matrix.
- Upload `scripts/verify/shots/` as an artifact and put the pass/fail table in
  the job summary, so it is readable on a phone without downloading anything.

---

## M5. The zoom-change shimmer

Capping every patterned source at `maxzoom: 16` fixed the flicker while flying —
WASD is now at the measured floor — but a **pure zoom change still crawls**:
38.3% against a 26.2% floor, and Q/E shimmers while held.

The fade is driven by the display zoom crossing an integer, not by which tile the
geometry came from, so no source setting can reach it. The plausible fix is two
pattern tiers switched by zoom: a softened tile on a far layer, the sharp one on
a near layer.

**Measure before committing to it.** It costs about ten more atlas images and the
per-image repaint recurs on every time-of-day step, which is a real cost against
an aesthetic gain. Use `scripts/verify/shimmer.mjs`; `zfight.mjs` is structurally
blind to this class of defect because it gates on a flat 3×3 neighbourhood.

Touches `js/facades.js` and the layer definitions in `js/app.js`. The Acer is not
in either file — but say so in the PR, because that could change.

---

## M6. Split HANDOFF.md

**Take this last.** ~91 KB, and every session on both machines reads all of it
before doing anything.

A short current-state file plus `docs/JOURNAL.md` for the history. **Keep the
numbered hard-won rules in the short file** — those are the part that stops
mistakes repeating, and they are the reason nobody has re-broken the orphaned
Chrome processes or the 8099 port collision.

Simeon has already approved this as an idle-time chore. It is last because both
lanes append to `HANDOFF.md` as they finish passes, so doing it while the other
machine is busy guarantees a conflict.

---

## M7. ~~Re-qualify pixel scripts onto hardware GL~~ — WITHDRAWN, it does nothing

**Do not take this. It was measured and it is worth 1.0×.** Left in place with
the numbers rather than deleted, so nobody re-derives the same wrong idea.

The reasoning was: ~100 scripts render on the CPU at 3.7 fps where this GPU does
35.3, so moving them should be a 9.4× win. `scripts/verify/requalify.mjs`
(Acer, PR #39) runs a script on both backends and compares. First two out:

```
retint          soft 141 s   hardware 138 s    1.0x
horizon-probe   soft  80 s   hardware  74 s    1.1x
```

**The 9.4× is a rendering number and a whole script barely renders.** It loads
28 MB, then it sleeps.

### What actually costs the time — take this instead

**880 seconds of hardcoded `waitForTimeout` across 87 scripts**, counted one pass
per file with loops *not* multiplied. That is ~15 minutes of every full run spent
deliberately doing nothing, on top of ~10–17 s per script re-loading the city.

Worst offenders: `drift-check` 48 s, `lookup-check` 36 s, `srcprobe` 26 s,
`arts-shots` 22 s, `light-probe` 19 s, `orbit-check` 19 s, `movement` 19 s.

The fix is per-script and needs judgement, not a sweep: a `waitForTimeout(6000)`
that could be a wait-for-actually-ready is free to remove; one that is masking a
race will fail intermittently and cost someone a week. Do the big ones, one PR,
with a before/after time in the description and each script run three times to
prove it did not get flaky.

Priority order for suite speed, measured not guessed: **sleeps → payload → more
machines → GPU (last)**.

### And a warning that applies to everything on this list

Load time in this suite varies **11 s to 65 s for an identical page and identical
flags** on a quiet machine. A single reading is worthless. The Acer built a whole
theory today on one sample — that 33 scripts skipping `cancelGraphicsAutoDetect()`
were paying ~50 s each — and two interleaved reps showed the probe costs nothing.
CLAUDE.md rule 8 (minimum of interleaved reps) is not a style preference.

They are on SwiftShader for a real reason: hardware and software rasterisers
disagree on **26–42% of pixels**, worst channel delta 192/255, so any script
asserting an exact hex would break. **That reason does not apply to all of
them.** `retint.mjs` asserts "is night darker than 38 luma". `horizon-probe`
asserts a line is above the buildings. Coarse, threshold-shaped assertions
survive a backend change; exact-hex ones do not.

**What:** triage every browser script into `exact-hex` (stays on SwiftShader,
forever) and `threshold` (can move). For each candidate, run it on both backends
and confirm the verdict is identical **with margin** — a threshold assertion that
only just passes on hardware is not qualified, it is lucky. Add `gl: 'hardware'`
only to the ones that pass that bar, and record the margin in the script's
header so nobody has to re-derive it.

`scripts/verify/gl-check.mjs` (Acer, PR #37) asserts the launch shapes resolve to
the backend they ask for; lean on it rather than trusting a flag list.

**Do not bulk-convert.** A pixel script that silently changes verdict is the
worst possible outcome here — worse than a slow suite, because it is a suite that
lies. One at a time, with the both-backends comparison in the PR.

---

## Two rules that are not negotiable

1. **Never register a self-hosted GitHub runner on this repo.** It is public; a
   stranger's pull request could run code on the machine.
2. **Never remove the watchdog or the reaper in `scripts/verify/chrome.mjs`.**
   They exist because 38 orphaned Chrome processes once took the laptop to 100%
   CPU and memory in the middle of a deadline.
