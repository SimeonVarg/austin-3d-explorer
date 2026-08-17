# What is clutter here, and what only looks like it

Measured on the Acer, 2026-08-17, against `origin/main` at `e10d591`.
**This document deletes nothing.** It is the decision, written down before
anything is removed, so the removal can be done fast and without argument
*after* the AWS recording.

The governing constraint tonight is that the app must record perfectly
tomorrow morning. Every recommendation below is sorted so that the safe,
zero-risk work comes first and anything that touches a tracked file, a
commit, or the deploy comes last — and the last group is explicitly
**not for tonight.**

---

## 0. The headline, and two corrections to the brief

The brief said `shots/` is 1.8 GB and that most of it is untracked. Both
halves are wrong in ways that change the answer.

**Correction 1 — `shots/` is not the biggest thing on disk.**

| Path | On disk | Files | Tracked? |
|---|---:|---:|---|
| `scripts/verify/shots/` | **1525 MB** | 759 | **none** — gitignored |
| `shots/` | 1749 MB | 1885 | 1353 tracked (1270 MB) / 532 untracked (474 MB) |
| `data/` | 290 MB | — | ~62 MB of it untracked reference PNGs |
| `research/` | 67 MB | — | tracked |
| `docs/` | 39 MB | — | tracked |
| `scripts/verify/node_modules/` | 14 MB | 115 | gitignored — **do not touch** |
| `.git/` | **3073 MB** | — | see §5 |

The single largest deletable object in this repository is
`scripts/verify/shots/` — 1.5 GB of harness scratch output that git has
never seen and never will, because `.gitignore:28` excludes it. It is
bigger than everything in `shots/` that is untracked, by a factor of three.

**Correction 2 — `shots/` is mostly *tracked*, not untracked.**
1270 of its 1749 MB is committed. That matters enormously, because
deleting a tracked file does not shrink the repository at all (§5).

---

## 1. Evidence vs litter: how the line was actually drawn

I grepped `HANDOFF.md`, `QUEUE.md`, `MAC_QUEUE.md` and every file under
`docs/` and `scripts/` for path references matching `shots/…`.

- **502 distinct shot paths are cited by the written record.**
- 171 of those are cited as an individual file.
- **125 of the ~170 directories under `shots/` are cited by name.**

That last number is the finding that kills any bulk sweep of `shots/`.
Three quarters of the folders in there are named in the record. A
directory citation cites *the set*, not one frame — `shots/facade/` in a
HANDOFF paragraph means the reader is being pointed at that folder, and
thinning it silently makes the paragraph lie. So the working rule is:

> A file is litter only if **neither it nor any ancestor directory** is
> named in `HANDOFF.md`, `QUEUE.md`, `MAC_QUEUE.md`, or `docs/`.

Applying that rule to the 1885 files under `shots/`:

- **362.7 MB is cited by nothing at all** (57 directories)
- **103.3 MB sits under a cited ancestor but is never itself named**
  (`facade/final2/raw`, `facade/raw`, `walk/gate3`, `entrances/night2`,
  `eye/street/tune`, …) — *these are the raw arms behind a judgement that
  was cited. They are evidence. They stay.*
- everything else is directly cited

Of the 362.7 MB that is cited by nothing, only **160.7 MB is also
untracked**. That is the honest size of the free win inside `shots/`.

### Two dead citations worth knowing about

`HANDOFF.md` and eight files under `docs/` cite paths under
`scripts/verify/shots/` — a **gitignored** directory. Two distinct such
paths exist; one of them, `scripts/verify/shots/after-N2-west.png`, is
**already gone**. Those citations were never real evidence for anybody but
this machine: nobody who clones this repo has ever been able to open them.
The lesson is for the next pass, not this one — promote a frame into
repo-root `shots/` before citing it.

---

## 2. DELETE — untracked, uncited, zero risk

Nothing in this section is tracked by git, referenced by the app, or named
in the written record. Deleting it cannot change a single byte that
GitHub Pages serves and cannot break a link in any document.

### 2a. The harness scratch directory — 1525 MB, 759 files

```
scripts/verify/shots/*        # keep the directory itself, and keep
                              # scripts/verify/shots/ref-dkr-georef.png
```

Gitignored at `.gitignore:28`. This is where `crop.mjs`,
`motion-shots.mjs` and the rest of the suite write every capture they
take; the ones that mattered were promoted by hand into repo-root
`shots/`. Regenerable by re-running the harness.

Keep the directory (harness scripts write into it) and keep
`ref-dkr-georef.png`, the one file in there a doc still points at and
which still exists.

**What this buys:** 1.5 GB of working tree, and a `scripts/` tree that
stops being 1.5 GB of noise around 57 real scripts. **What it does not
buy:** nothing in `.git`, nothing in the deploy, nothing in the app. It
is pure disk.

### 2b. Superseded sweeps under `shots/` — ~134 MB, 183 files

All untracked, all uncited, each one superseded by something that *is*
cited and kept.

| Delete | MB | Files | Superseded by (kept) |
|---|---:|---:|---|
| `shots/ent-after/` | 33.8 | 52 | `shots/entrances/final/` — cited, 26 frames |
| `shots/i2new-*`, `shots/i2port-*` | 16.9 | 20 | `shots/intro-gate/` — cited contact sheet |
| `shots/h2shim/` | 15.6 | 16 | `shots/h2-merged/`, `shots/h2-after/` — both cited |
| `shots/after-*`, `shots/after2-*` | 9.8 | 12 | middle two arms of a 4-way sweep; `before-*` and `final-*` kept |
| `shots/intro-*` (raw seconds) | 8.7 | 11 | `shots/intro-gate/` — cited contact sheet |
| `shots/tree/` | 6.8 | 20 | `shots/trees/`, `shots/canopy/` |
| `shots/entb-*`, `shots/entb2-*` | 6.3 | 8 | older generations of the same 4 entrance poses |
| `shots/wcg-*` | 5.4 | 5 | tracked `shots/wcl2-*`, `wcl3-*`, `wclobby-*` at root |
| `shots/cap-night-before/`, `shots/cap-night-after/` | 5.4 | 4 | `shots/capitol-night-before/` + `-after/` — cited **and tracked** |
| `shots/wcafter-close-*` | 4.7 | 4 | tracked `wcl2-*` set |
| `shots/enta2-*` | 3.9 | 5 | older generation, superseded by `entb2-*`→`entrances/final` |
| `shots/lbl-*`, `shots/lblon-*` | 5.8 | 8 | keep only the newest generation, `shots/lblon2-*` (3 files) |
| `shots/i2ab/` | 2.6 | 2 | `shots/i2-cand/`, `shots/i2-end/` — both cited |
| `shots/probe-a..d.png` | 2.5 | 4 | unlabelled probe frames, nothing points at them |
| `shots/h1-a1/` | 2.0 | 2 | `shots/h1-tower-night/` — cited |
| `shots/k.png` | 1.9 | 1 | `shots/k2-*`, `shots/k5/` — cited |
| `shots/cap-dusk-after/` | 1.5 | 1 | `shots/cdusk/` — cited |
| `shots/outer-tiled.png` | 1.4 | 1 | `shots/outer-after/` — cited |

The four-way sweep at the root of `shots/` is worth calling out because it
is the clearest case in the whole repo: six poses were shot four times
(`before-`, `after-`, `after2-`, `final-`) and only the first and last
carry a claim. The two middle arms are 12 files of nothing.

### 2c. HOLD — untracked and uncited, but decisive-shaped (~17 MB)

I am explicitly *not* recommending these for deletion. They are small,
and each one is either a named before/after pair or a merged contact
sheet, which is exactly the shape of a thing somebody meant to keep and
forgot to cite.

```
shots/h1-before/ , shots/h1-after/    10.6 MB, 15 files — a paired A/B
shots/k6-final/                        2.8 MB,  5 files — named "final"
shots/tod-merged/                      1.9 MB,  1 file  — merged contact sheet
shots/lblon2-*                         1.6 MB,  3 files — newest label generation
```

17 MB is not worth the risk of being wrong about what a frame proved.

**Section 2 total: ~1659 MB, all untracked, all zero-risk.**

---

## 3. DELETE — untracked reference PNGs under `data/` (~28 MB)

```
data/canopy_debug_corridor.png      9.8 MB
data/canopy_debug_westcampus.png   14.2 MB
data/canopy_debug_southmall.png     4.3 MB
```

Gitignored (`.gitignore:9`). I grepped `js/`, `index.html`, `scripts/`,
`docs/` and `data/*.json`: **nothing references any of the three.** They
are debug overlays from the canopy bake, and the canopy bake's real output
(`data/canopy_detected.json`) is what the pipeline consumes.

### KEEP the other big untracked PNGs in `data/`

| File | MB | Why it stays |
|---|---:|---|
| `data/dkr_aerial_geo.png` | 14.6 | read by `scripts/bake_stadium.py`, georeferenced by `data/dkr_aerial_geo.json` |
| `data/capitol_aerial.png` | 10.2 | read by `scripts/bake_capitol.py` |
| `data/dkr_aerial.png` | 7.2 | read by `scripts/bake_stadium.py`; the source of the `#C5C1B6` deck colour cited in `js/facades.js:364` |

These are the *references* the reference-to-generator method runs on.
Deleting them means the next person re-fetches them or guesses a colour.
They stay.

### KEEP all twelve `data/snapshots/` dates (60 MB)

All twelve are listed in `data/manifest.json` under `"snapshots"`, and the
date-picker and diff-tour read that manifest at runtime. There are no
duplicates here — each is a distinct 5 MB day of Austin building data, and
`data/diffs/` is built from consecutive pairs. **Deleting any one of them
breaks the date switcher in the app.** This is the trap in the task list;
they look like twelve copies of the same thing and they are not.

---

## 4. Scripts, docs, and other suspected dead weight

I checked for uncalled scripts rather than assuming. **I found none worth
removing.** `scripts/` holds 57 `.py`/`.mjs` files plus 222 tracked files
under `scripts/verify/`; the bake scripts are each the sole owner of an
output file (that is the lane boundary in `CLAUDE.md`), so an "uncalled"
bake script is still the only way to regenerate its data file. Removing
one would delete the ability to rebuild a shipped artifact.

`scripts/__pycache__/` is 1 MB and already gitignored (`.gitignore:1`).
Not worth a line in a delete script.

No superseded docs found. `docs/` is 39 MB and 30 of its files are
actively cited from `HANDOFF.md`. `docs/verify/the-twelve.md` (16.5 KB) is
untracked — that is a *new* document from yesterday, not dead weight; it
should be committed, not deleted, and it belongs to whichever lane wrote
it.

---

## 5. Be honest about what deleting buys — and what it does not

**A deleted committed file does not shrink this repository.** The blob
stays in history forever. Only history rewriting removes it, and we are
not rewriting history the night before a recording. So:

| Action | Working tree | `.git` | Pages deploy | App |
|---|---|---|---|---|
| delete untracked files (§2, §3) | **−1687 MB** | 0 | 0 | 0 |
| delete tracked frames from `shots/` | −N MB | **0** | −N MB | 0 |
| prune remote branches (§6) | 0 | ~0 | 0 | 0 |
| `git gc` | 0 | see below | 0 | 0 |

### The `.git` directory is 3073 MB and that number is misleading

```
count:      8715 loose objects
size:       2.88 GiB   (loose)
in-pack:    478 objects
size-pack:  53.29 MiB  (packed)
```

The "53 MiB packed repo" figure in the brief is `size-pack` only. It
describes 478 objects. The other 8715 objects — 2.88 GiB — are sitting
loose because nothing has run `git gc` in a long time.

`git gc` is **not** history rewriting. It repacks loose objects and prunes
unreachable ones. I measured what it would actually prune:

```
git prune -n --expire=now  →  820 unreachable objects, 430 MB on disk
```

So the honest expectation is: **`.git` drops by roughly 430 MB, to about
2.6 GB — not to 53 MiB.** The remaining 2.4 GB is reachable PNG blobs, and
PNG is already deflate-compressed, so packing them wins almost nothing on
content. Anyone who promises this repo shrinks to 53 MiB without rewriting
history is wrong.

**Do not run `git gc` tonight.** It is safe, but it churns `.git` for
several minutes holding locks, two other lanes are running, and it buys
disk rather than app health. Run it after the recording.

### The one place tracked frames genuinely cost something

`.github/workflows/deploy-pages.yml` uploads `path: '.'` — **the entire
repo root** — as the Pages artifact on every push to `main`. That means
1270 MB of tracked screenshots is packed, uploaded and deployed every time
anyone merges. It works (the site is live), so this is a slowness, not a
breakage.

The right fix is **not** to delete evidence. It is to stop shipping
screenshots to a web host — exclude `shots/` from the Pages artifact
path. That is a workflow change, it touches the thing that publishes the
app Simeon is recording, and it is **absolutely not for tonight.** Written
down here so the next lane picks it up.

---

## 6. The 53 remote branches

`git branch -r --merged origin/main` and a commit-subject sweep of the
rest. 55 remote refs, minus `main` and the branch this document is on.

### Safe to prune — 25 merged into `main`

Every commit is on `main`. Deleting the ref deletes nothing.

```
acer/dkr-unblock                 acer/dof-horizon-line
acer/gitignore-secrets           acer/j1-h5-roofs
acer/mobile-eye-level            acer/n5-coplanar
acer/roof-slope-depth            acer/ut-building-register
claude/austin-3d-environment-plan-28jgco
claude/austin-3d-ground-textures-f1dc7c
claude/building-pass-defects-d9bfa4
claude/campus-architecture-precinct-6c39a0
claude/campus-restaurant-shopfronts-0878d4
claude/drag-pass
claude/modern-precinct-curtain-wall-acb873
claude/night-scene-lighting-bc9a93
claude/road-classification-bike-lanes-1c6441
claude/union-24th-building-research-qhzrpc
claude/ut-tower-main-building-6d71ec
claude/west-campus-towers-0fef2c
data/extend-radius               data/ground-life
look/roofscape                   phase-1-fixes-and-phase-3
phase-1-frontend
```

### Safe to prune — 21 "unmerged" whose every commit is already on `main`

These read as unmerged to `git branch --merged` because they were
squashed or rebased in, so the SHAs differ. I checked **every commit
subject on each branch** against `main`'s log; all of them match.

```
acer/art-accurate-size-recovered   acer/basemap-cull
acer/facade-bake                   acer/fountain-steps
acer/giant-hedge                   acer/j2-j4-churches-trucks
acer/j5-j8-ground-planting         acer/outer-far-clamp
acer/roof-hole-coverage            acer/tree-species
acer/trees-off-surfaces            acer/westcampus-ground
claude/buildings-not-loading-i14pgd
feat/visuals-movement-sky          fix/bake-wn-difftour-trees
mac/canopy-coverage                mac/clip-camera-safe
mac/creek-trees                    mac/dkr-south
mac/outer-bucket-inert             mac/verify-suite-repair
```

A trap here: most of these branches' *tip* commits are the automated
`Add 2026-08-0X snapshot of Austin building data` bot commit, which is
also on `main`. Checking only the tip would have marked half of the truly
unique branches as safe. It is the second commit down that carries the
work.

### Also safe — 2 superseded

```
acer/perf-hardware-gl   — entirely contained in acer/cloud-proposal (kept)
time-of-day-system      — entirely contained in add-plan (kept)
acer/k5-two-suns        — its one unique commit edits only HANDOFF.md, and
                          its text ("downtown is cooler than campus") is
                          already on main. Its frames were never committed
                          anywhere; the only copies are the untracked files
                          in shots/k5/ and shots/k5-scout/, both of which
                          are CITED and kept by §2.
```

### KEEP — 4 carrying the only copy of something

| Branch | What is on it and nowhere else |
|---|---|
| `acer/n12-vertical` | PR #189. `shots/vert/V1–V4`, `D7/D8`, `VERDICT-01…05`, `r1-*`, `ab.json` — 31 A/B and verdict frames. Only `shots/vert/final/FINAL-01…06` reached `main`. |
| `acer/facade-choice` | PR #164. `shots/facade/raw/x-*.png` — the 15 raw A/B/0 arms and the two noise-floor frames. `final/CHOOSE-*` and `scout/` are on `main`; **`raw/` is not**. |
| `acer/cloud-proposal` | 23 unlanded edits to the perf harness (`perf.mjs`, `chrome.mjs`, `gl-check.mjs`, and 20 `*-perf.mjs`) implementing hardware GL. The *finding* is on `main` in `docs/CLOUD.md` and `docs/perf/measured.md`; the *code* is not. Contains `acer/perf-hardware-gl` whole. |
| `add-plan` | The July 10 origin branch, base of PR #5. Contains `time-of-day-system` whole. Free to keep; it is the earliest history. |

**Net: 48 branches prunable, 4 kept, plus this one.** That takes the
branch list from 55 to 6, and costs nothing — a remote ref is a 41-byte
file.

---

## 7. The three open PRs

I checked whether each PR's decisive frames are on `main` before
recommending anything, because closing a PR and deleting its branch is how
evidence quietly dies.

### #189 — "REFUSED, DO NOT MERGE — the vertical axis as geometry"

**Close it, with a comment. Do not delete the branch.**

The verdict frames *are* on `main`:
`shots/vert/final/FINAL-01-VERDICT-battle-hall-day.png` through
`FINAL-06-what-changed.png`, plus the commit
`65ff5fb "The vertical barcode cannot be fixed with geometry, and here is
the picture"`. The refusal is safely in the record without the PR.

But the 31 intermediate A/B frames (`V1-SOUTHMALL-west-wall-day-base2`
vs `-bays`, the five `VERDICT-*` composites, `ab.json`) exist **only** on
`acer/n12-vertical`. Keep the branch. The closing comment should say in
one line: *refused on looks at the pose it was meant to win; verdict
frames are on main under `shots/vert/final/`; the A/B arms are on this
branch.*

### #164 — "DECISION BRANCH — the two candidate walls for the Drag"

**Close it, with a comment. Do not delete the branch.**

`shots/facade/final/CHOOSE-from-600m.png`,
`CHOOSE-the-drag-at-eye-level.png`, `_diff-0-vs-B.png` and all nine
`scout/` frames are on `main`, as is `docs/camera/facade-choice.md`. So
the question Simeon was asked to answer is still visible on `main`.

`shots/facade/raw/x-*.png` — the raw cruise/eye arms for 0, A and B at day
and night, and the two noise-floor frames — are branch-only. Keep the
branch.

An eleven-day-old PR whose title starts "DO NOT MERGE AS IS" is not
serving as a question any more; it is serving as a shelf. A closed PR with
a one-line comment is a better shelf, and it stops the PR list from
implying there are three live decisions outstanding.

### #5 — "Add complete front-end and handoff documentation" (July)

**Close it. No comment needed beyond one line.**

This one is not what it looks like. Its head is `main` and its base is
`add-plan` — it proposes merging `main` *into* the old July `add-plan`
branch, backwards. It has been open since July 10 and cannot usefully
merge. Close it and keep `add-plan` as history.

---

## 8. The lists

### DELETE — safe, zero-risk, nothing tracked

```
scripts/verify/shots/*          1525 MB   (keep the dir + ref-dkr-georef.png)
shots/  §2b, 183 files           134 MB
data/canopy_debug_*.png (×3)      28 MB
------------------------------------------
                                1687 MB
```

Plus 48 remote branch refs and 3 PR closures — which free no bytes and
are purely about being able to read the branch and PR list.

### KEEP — explicitly

```
all 1353 tracked files under shots/            1270 MB
shots/aws/                                      207 MB  ← the recording reference
shots/**/final/ and final2/  (every one)
the 103 MB of raw arms under cited parents      (facade/raw, facade/final2/raw,
                                                 walk/gate3, entrances/night2,
                                                 eye/street/tune, wampus/n2, …)
shots/before-*  and  shots/final-*               9.8 MB  (decisive pair)
§2c HOLD set                                      17 MB
all 12 data/snapshots/ dates                      60 MB  ← app breaks without them
data/dkr_aerial*.png, data/capitol_aerial.png     32 MB  ← bake inputs
scripts/verify/node_modules/                      14 MB  ← never git clean -x
all 57 scripts                                          ← each owns an output file
branches: acer/n12-vertical, acer/facade-choice,
          acer/cloud-proposal, add-plan
```

### Where the working tree lands

| | Before | After |
|---|---:|---:|
| `scripts/` | 1540 MB | 15 MB |
| `shots/` | 1749 MB | 1615 MB |
| `data/` | 290 MB | 262 MB |
| everything else tracked | ~110 MB | ~110 MB |
| **working tree** | **~3.69 GB** | **~2.00 GB** |
| `.git` | 3073 MB | 3073 MB (→ ~2.6 GB if `git gc` runs *after* the recording) |
| **total on disk** | **~6.76 GB** | **~5.07 GB**, or ~4.6 GB after `gc` |

A 46% cut to the working tree, and not one committed frame, not one line
of the written record, and not one byte the app loads is touched to get
it.

---

## 9. What must not happen

- **No `git clean -x`.** It would delete `scripts/verify/node_modules/`
  and every gitignored bake input in `data/` — including the three aerial
  references that cost a fetch to replace. The §2/§3 deletions must be an
  explicit path list, never a blanket clean.
- **No `git stash -u`, no history rewrite, no force-push.**
- **Do not delete `acer/n12-vertical` or `acer/facade-choice`.** Their raw
  arms are not on `main`.
- **Do not thin any `data/snapshots/` date.** The manifest lists all
  twelve and the app reads it.
- **Do not touch `deploy-pages.yml` before the recording.**
- **Nothing in `shots/aws/` gets deleted**, including the `slow-*` and
  `cpu4b-*` probe sequences the brief flagged. They are per-rep frames,
  but they are per-rep frames *of the recording target*, sitting in the
  folder the recording brief reads from, and 8 of the groups in there are
  cited by `docs/aws/*.md`. 207 MB is a cheap price for not gambling with
  tomorrow morning.

---

## 10. EXECUTED — 2026-08-17, acer lane, branch `acer/r2-declutter`

Sections 2, 3 and 6 were carried out against `origin/main` at `e10d591`.
**Five findings in this document turned out to be wrong, and the deletions were
narrowed accordingly.** Every one was caught by re-testing the claim rather than
trusting the table.

### 10a. §2b over-reaches — nine entries are cited evidence and were KEPT

§1 states the rule correctly: *a file is litter only if neither it nor any
ancestor directory is named in the record.* §2b then lists paths that fail that
very rule. Re-running the citation check with `docs/cleanup.md` itself excluded
from the corpus — it cites every path it proposes to delete, which made the
first sweep look self-confirming — these are cited and were **not** deleted:

| Kept | Cited by |
|---|---|
| `shots/ent-after/` (33.8 MB) | `HANDOFF.md:1599,1693,1707` — `z-PCL.png`, `zn-BTL.png`, `z-MAI.png`, the AFTER half of a named before/after pair |
| `shots/tree/` (6.8 MB) | `HANDOFF.md:13455,13458,13461` — `before-0-standing.png`, `before-1-after-walk.png`, `after-1-after-walk.png`. Not superseded by `shots/trees/`; a distinct pair |
| `shots/i2ab/` (2.6 MB) | `HANDOFF.md:4542,4590` — `veil-00ms.png`, "the first frame a visitor sees" |
| `shots/entb-*`, `shots/entb2-*`, `shots/enta2-*` | four frames cited individually; the whole generation kept, since a cited arm implies its sweep |
| `shots/i2new-*`, `shots/i2port-*` | `i2new-0006s-landscape.png` ("the crest") and `i2port-16.5s-portrait.png` cited |

### 10b. §2b's `shots/wcg-*` glob catches THREE TRACKED files

`shots/wcg-groundfloor-day.png`, `-night.png` and `-westcampus.png` are tracked.
§KEEP protects all tracked files under `shots/`, so the glob contradicts the
list on the same page. Only the five untracked `wcg-after-*` frames were removed.

### 10c. `shots/k.png` does not exist

Already gone before this pass. Harmless, but it aborted the first delete script
under `set -e` and silently truncated the list — worth knowing.

### 10d. §6 under-counts the branches carrying unique work: 18, not 4

The decisive test is not "are the commits on main" but **"does this branch's tree
contain a file `main` does not have."** By that test 18 branches carry unique
files, not 4. Most are old rotated-off `data/snapshots/` dates, but one is real
evidence §6 listed as safe to prune:

- **`acer/roof-hole-coverage`** — 16 unique files including
  `scripts/verify/art-sheet.mjs` and `shots/roofdiag/{church,greg}-{before,after,compare}.png`.
  It was in the "safe to prune, merged into main" list. It is not safe. **Kept.**

Also kept, which §6 could not have known: **`acer/j1-h5-roofs`** and
**`acer/outer-far-clamp`** are checked out in live lane worktrees right now.

**33 refs pruned, 21 kept.** Every pruned ref was verified to add zero files to
`main` immediately before deletion.

### 10e. §7's advice on #189 and #164 was NOT followed

Their frames are **not** on `main` — `acer/n12-vertical` holds 30.3 MB across 32
files and `acer/facade-choice` 45.7 MB across 66. The gate for closing them was
"only if the frames are on main". Landing 76 MB of A/B arms onto `main` hours
before the recording would enlarge the Pages artifact (§5) for no recording
benefit, so **both PRs were left open and both branches kept.** #5 was closed:
its base is `add-plan` and its head is `main`, so it proposes merging main
backwards into the July branch, and it is CONFLICTING.

### 10f. What was actually reclaimed

| | Before | After |
|---|---:|---:|
| `scripts/` | 1543 MB | 22 MB |
| `shots/` | 1876 MB | 1815 MB |
| `data/` | 301 MB | 273 MB |
| working tree (excl. `.git`) | 4737 MB | 3126 MB |
| `.git` | 3095 MB | **3095 MB** |

**1611 MB reclaimed, all of it untracked.** `.git` did not move by a single
byte, and the packed repository did not shrink, because every blob ever
committed is still reachable from history — only a history rewrite removes
those, and that was correctly forbidden the night before a recording. What the
deletion buys is working-tree size, checkout time on a fresh clone's untracked
scratch, and a `scripts/` tree that is 22 MB of scripts instead of 1.5 GB of
harness output. What it does not buy: nothing in `.git`, nothing in the Pages
deploy, nothing in the app.

### 10g. Proof the app is untouched

- `git diff origin/main -- index.html style.css js/ data/` — **empty.**
- All **2529** files under `index.html`, `style.css`, `js/`, `data/`
  re-hashed against the pre-cleanup SHA-256 list — **2529 OK, zero mismatches**
  (the 3 gitignored `canopy_debug_*.png` are excluded; they are write-only
  `--debug` output of `scripts/detect_canopy.py:234` and nothing reads them).
- `harness-drift.mjs` — **PASS**, 29 scripts = 29 scripts.
- `index.html?clip=1&preset=cinematic` on port 8561 — **PASS**: `.clip` set, all
  15 chrome elements hidden, OSM credit visible
  ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap"), **zero console
  errors**. Frame: `shots/r2/clipgate-cinematic.png`.
- The one `net::ERR_ABORTED` on `data/tiles/trees.pmtiles` is a pmtiles range
  request the reader cancels. The file is present, unmodified, and serves
  HTTP 206; `trees-trunk` and `trees-canopy` are in the rendered style. It is
  not a console error and is not caused by this pass.
