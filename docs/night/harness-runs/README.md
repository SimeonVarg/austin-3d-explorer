# The `--break` / `--same` runs, kept

`docs/night-implementation-plan.md` §W0a says `--same` — the only assertion in
`scripts/verify/night-compare.mjs` — can go red, and quotes numbers for it. Those numbers
used to have **no surviving artifact anywhere**: the plan itself condemned the earlier
state with *"no `report.json` under `<scratch>/lanes/night/harness/*` carried either flag"*,
and after the fix that sentence was still true, because the demonstration ran in a session
scratch folder that gets swept. A claim whose evidence is deleted is a claim on trust.

So the reports live here. They are the harness's own output, unedited except that absolute
paths have been rewritten to `<scratch>`, `<worktree>` and `<reference-images>` (this repo
is public). They carry no photograph: every one was shot `--refs off --local none`.

| file | what it is | verdict |
|---|---|---|
| `same-control.report.json` | A against B, no sabotage, `wc-elevated` + `capitol` at `night`, `--same 1` | **PASS**, exit 0. A/B pixels over 16 luma: min 0.000, median 0.003, max 0.005% over 5 frames |
| `same-break-apartments.report.json` | the same five poses, `--break` (authored apartments removed), `--same 1` | **FAIL**, exit 1. `over-drag-wnw` 8.160%, `down-on-ion` 7.101%, `over-mlk-north` 3.650%; bright windows 13.349 → 1.850 |
| `same-break-slopes-capitol.report.json` | `capitol` at `night`, `--break slopes` (**every** authored group removed), `--same 1` | **PASS**, exit 0 — and that is the finding, not a comfort. See below |
| `noise-floor-main-daygolden.report.json` | **A9's floor**: `main` @ `13741fa` against itself, two page loads, 16 poses × day and golden | **0.000% on all 32 frames**, 24 of them byte-identical JPEGs — this is where `--same 0.05` comes from |
| `build-ab-c656249-vs-main-daygolden.report.json` | `c656249` against `13741fa` at the same 32 frames | day 0.612 / 8.216 / 13.504%, golden 0.003 / 1.802 / 5.672% — the shadow fix arriving. **Its side labels are wrong**; read `committedCopy` |
| `baseline-c656249.report.json` | the §W0a baseline: 16 poses × 4 regimes on `main` @ `c656249`, one side | the three committed sheets in `docs/shots/` are re-derived from it bit-identically |
| `early-regime-shoot.report.json` | the 05:02 Z `early` shoot, whose 16 shots are merged into the baseline | its side block: 196 buildings, 2 reloads then the poke, harness `0745d6b` |
| `r10-1440x900-lite.report.json`, `r10-393x852-lite.report.json` | R10's legs 2 and 3 (`?lite=1` landscape, `?lite=1` portrait) | the two legs the §7.1 aspect finding rests on, three minutes apart on one harness commit |

`baseline-c656249.report.json` is the one to read first: its `provenance` block says **48 of its 64
shots** came from the shoot its top-level `when`/`args`/`harnessGit` describe, and `merged[]` says where
the other 16 came from. That accounting is the whole point — before 2026-09-21 the file claimed all 64.
The `early` copy has the six owner-matched overlay shots removed (they name a viewpoint); its
`committedCopy` field says so.

## The green one is the important one

`same-break-slopes-capitol` removed **3,560,273 triangles** of authored geometry — the
Capitol dome, the Tower, the stadium, the roofs, the arches, the art, the campus landscape
and the apartments — and the two Capitol frames moved by **0.172%** and **0.308%** of pixels.
`--same 1%` passed. The dome is plainly gone when you look (`docs/shots/night-break-capitol-noop.jpg`).

That is a measurement of the instrument, not of the scene: at these poses the authored
geometry is a small share of the frame, so a 1% tolerance cannot see it disappear. Every
pose behaves this way to some degree, and the per-shot `slopes` block in each report says
which groups were on at that camera. Read `verdict.breakCoverage` before quoting any pose
as covered by `--same`.

**And then the floor was measured and 1% turned out to be the wrong number, not the
sabotage.** `noise-floor-main-daygolden.report.json` is `main` against itself at the two
A9 regimes: **0.000% on every one of 32 frames**. Against a floor of zero, 0.172% is an
enormous signal. A9's tolerance is `--same 0.05` now, and at 0.05 the Capitol wipe is red
without re-shooting anything:

```bash
node scripts/verify/night-compare.mjs --out <that run> --from <that run> --same 0.05 --refs off
```

## Reproducing them

```bash
python scripts/serve.py 8661
SITE=http://127.0.0.1:8661 node scripts/verify/night-compare.mjs \
  --out <scratch>/control --only wc-elevated,capitol --regimes night \
  --a '' --b '' --same 1 --refs off --local none          # expect exit 0

SITE=http://127.0.0.1:8661 node scripts/verify/night-compare.mjs \
  --out <scratch>/break   --only wc-elevated,capitol --regimes night \
  --a '' --b '' --break --same 1 --refs off --local none  # expect exit 1

SITE=http://127.0.0.1:8661 node scripts/verify/night-compare.mjs \
  --out <scratch>/slopes  --only capitol --regimes night \
  --a '' --b '' --break slopes --same 1 --refs off --local none
```

On the Acer, wrap each one in the session's GPU-slot runner; parallel hardware-GL Chromes
blue-screen that machine.
