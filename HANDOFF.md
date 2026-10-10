# Austin 3D Explorer - current state

Short on purpose. Last rebuilt 2026-10-04 from `git log origin/main`, `gh pr list`,
`QUEUE.md`, `MAC_QUEUE.md` and the newest journal entries. Anything not confirmed
there is left out. **History is not here any more:** it moved, byte for byte, to
`docs/journal/` (index: `docs/JOURNAL.md`). Do not append history to this file.

## What the app is

A 3D map of Austin and the UT campus in the browser. Plain static HTML, CSS and
JS served from the repo root (MapLibre plus custom layers and baked data in
`data/`). The point of it: apartments, then walking distance, then classes (the
apartment finder ranks homes by minutes to your class schedule). There is no
build step for the site itself; data and tiles are baked by scripts in `scripts/`.

## What is live

- Every push to `main` deploys the static site to GitHub Pages
  (`.github/workflows/deploy-pages.yml`). Data snapshots arrive from
  `build-data.yml`. So "live" means "what is on `main`". Check `main` before
  saying anything is live.
- Last things merged (newest first): #426 DKR stadium's four north stair towers are round brick towers (brick piers, dark glass strips, pale ledge, glass ring, rim and cap box; places and sizes from the laser scan, the stack from the owner's photograph; lower bodies and the two north-east towers inferred; `STADIUM_MESH.roundTowers`) (Oct 9). #425 DKR west face, second pass: the window bands were hidden behind the wall sheet by day; the wall is drawn around them and the bands are dark; check 7b in `docs/photo-audit.md` (Oct 9). #424 DKR stadium west face from the owner's photographs: cream solid wall with proud piers, ribbed panels, window bands and a centre pylon (`STADIUM_MESH.west`; bay width and level heights inferred; the other three faces, the upper deck and the brick stair towers are not done) (Oct 9). #423 Welch Hall's newer wing, west wall: terracotta lattice screens, slit windows and a lighter top storey from the owner's photograph (sizes approximate) (Oct 9). #422 Welch Hall west entrance (stone surround, framed window above, landing and steps; sized from the flattened photograph, placed from the laser scan) (Oct 9). #420 Welch Hall outer walls from the owner's flattened north wall photograph (window 1.55 x 2.8 m, bays 2.9 m, limestone base with tall windows) and the north CHEMISTRY entrance with steps; a colour written as a bare string no longer stops a building from being drawn (Oct 9). #419 AWS GPU runner: results and the log always come back (the owner's setup is done; the first run started with no key and stopped itself but returned nothing, which this fixes) (Oct 9). #413 Moontower rebuilt from the laser scan and flattened photographs: low boxes in front of both wings, tiers of three floors, glass strips, corner glass box on the notch corner (`scripts/author_moontower.py`; west, south and north walls inferred) (Oct 9). #418 Welch Hall to the laser-scan height, 20.3 m (was 18.2 m), storeys 4.73 m, 13 bays on each east face; new recipe option `roofBase` lifts kept campus roof pieces with the walls (Oct 9). #366 AWS GPU runner: a keyless setup stack (`scripts/aws-gpu/setup-stack.yaml`) and a hand-started workflow "AWS GPU checks" (Oct 8; NOT yet run on AWS: it waits for the owner's one browser session, see `scripts/aws-gpu/README.md`); #417 Welch Hall courtyard, second pass: the terrace's west end is a balcony, single windows on the west court wall, one small shrub, all from a camera fitted to the photograph's window corners (Oct 8, 18 CI checks, every job run). KNOWN FAULT, next job: Welch Hall is modelled about 2 m too low (laser scan 20.3 m, recipe 18.2 m); #416 Welch Hall courtyard, first pass: the old wing's court walls get pairs of windows in three rows over a stone base (Oct 8, 18 CI checks, every job run; `old_wing()` in `scripts/author_welch_courtyard.py`); #415 brick in mixed tones: a tone per brick and soft areas that show from far away (Oct 8, 18 CI checks, every job run; `?brickpatch=0&brickmottle=0` shows the old flat brick); #414 Welch Hall east wall: three window rows with stone bars, the photographed arch shape, 4.2 m bays, measured colours (Oct 8, 18 CI checks, every job run; a band may now carry its own `floors`); #412 the same arches continued through the middle stretch of that wall (Oct 7, 84 CI checks, every job run); #411 round arches on the south part of Welch Hall's east arcade (Oct 7; all 84 CI checks passed; seen on the live site from the photograph's camera the same day); #410 photo-rollout tools (not part of the site); #409 a local reference-viewer helper (a Mac tool, not part of the site); #408 ground detail across campus and West Campus and #406 campus roof tiles visible at middle distance (both checked on the live site, Oct 6); #407 bakes skip the generated ground patches; #388 Burdine Hall and the Norman Hackerman
  Building with the compact wall material (Oct 2-3); #383 2400 Nueces and #379
  Ion Austin, the two buildings from street photographs that passed the owner's
  look (Oct 1); #369 the city comes back after the browser loses its graphics
  context; #354 desktop memory; #373, #375, #376 smaller fixes.
- Since #388 every commit on `main` is docs only: photo-evidence rules, photo
  pilot and reconstruction comparison records (`docs/photo-pilot-2026-10-03.md`,
  `docs/photo-source-provenance.md`, `docs/photo-evidence-context-2026-10-03.md`).

## Open pull requests (from `gh pr list`, 2026-10-04)

| PR | Branch | State |
|---|---|---|
| #399 | `acer/sky-turn-direction` | draft: the GL sky now banks with the camera when you turn (clouds, stars, horizon haze and the sun's disc used to stay level while the world leaned up to 5 degrees). Yaw and pitch were already right. Gate: `scripts/verify/skyturn.mjs` (GPU slot, 18 assertions, desktop and phone). Overlaps #348 in `updateSky` |
| #395 | `acer/lidar-heights` | roof heights from the 2021 lidar. The owner chose "raises only" (2026-10-04): by default about a hundred plain prisms the scan reads taller are raised, from `data/lidar_raises.json` (`scripts/bake_lidar_raises.py`: a tower on a podium is raised to the height half its roof reaches). `?lidarheights=0` is off, `?lidarheights=all` adds lowerings of up to 3 m. Read `docs/lidar-heights.md`; `drawn-heights.mjs` must run with the scan OFF (its default) or the next bake raises nothing |
| #366 | `claude/aws-gpu-runner` | draft: AWS GPU runner for the browser checks |
| #348 | `claude/sky-roll` | open: sunset sky glow follows camera bank |
| #347 | `claude/loading-fit` | open: loading screen fits one phone screen |
| #327 | `claude/speed-shaders` | open: shaders start compiling at second one |
| #320 | `codex/baked-enclosure-layer` | draft: optional baked enclosure shading |
| #312 | `codex/compiled-building-lifecycle` | draft: guarded compiled building lifecycle |
| #307 | `claude/finder` | open: apartment finder "Where should I live?" |
| #189 | `acer/n12-vertical` | REFUSED, DO NOT MERGE (QUEUE Y19) |
| #164 | `acer/facade-choice` | DECISION BRANCH, DO NOT MERGE AS IS (QUEUE Y5) |

Why each one is still open is not recorded here; read the PR, and the journal
entry for its branch name, before touching it.

## Lanes

Full rules: `CLAUDE.md` (same text in `AGENTS.md`). The short version:

- Two lanes split by bake script. Each bake script owns exactly one output file
  and nothing else writes it. A lane may read any file but writes only its own.
  If you need a schema change in someone else's file, ask for it in this file.
- Acer lane: everything not named in `MAC_QUEUE.md`. Mac lane: see below.
- Lanes merge their own PRs after re-running verification on the merged result.
  Never merge red. Delete the branch after merging.
- Docs-only commits (`CLAUDE.md`, `HANDOFF.md`, `docs/`, `QUEUE.md`,
  `MAC_QUEUE.md`) may go straight to `main`; always pull first. Code goes
  through a branch and a PR.
- Ask the owner about taste; decide everything else and write down why.
- The repo is public: no personal info, paths, photo ids or camera positions in
  any tracked file or commit.
- `MAC_QUEUE.md` is stale and says so at its top. Who writes what on
  2026-10-05 (the main lane now runs on the Mac too, in its own work copy):
  - The second lane on the Mac (branches `codex/*` and `mac/*`) writes the roof
    and lighting pass on `codex/mac-roofs-motion`: `js/wall-patterns.js`,
    `js/slopes-roofs.js`, `js/slopes.js`, `js/city-lighting.js`. Not merged: the
    roof look at middle distance is a taste call that waits for the owner.
  - The ground bake is lent to that same lane for its ground-detail pass:
    `scripts/bake_ground.py`, its one output `data/ground.geojson`,
    `js/ground.js`, and one new bake input, `scripts/ground-detail-sources.json`
    (selected public survey shapes and reviewed surface assignments; no new
    fetch at run time). The main lane does not write these four until that
    lane hands them back in this file.
  - A third task on the Mac evaluates an outside viewer project (MIT) as a
    separate research tool. It writes NEW files only: `scripts/gods-eye/` (local
    setup, launcher, camera links) and one assessment in `docs/`. It imports no
    outside code into the app and does not touch `index.html`, `js/app.js` or
    the terms page.
  - The local God's Eye View companion is set up at the reviewed upstream pin.
    `scripts/gods-eye/README.md` describes launch, offline panorama projection
    and explicit camera conversion; `docs/gods-eye-view-assessment.md` records
    where it helps and what remains a reference. It adds no renderer,
    credential or dataset to the shipped city. Merged as PR #409 (`8c6483e`).
    Wednesday preparation on `codex/photo-rollout-prep` adds only
    `scripts/photo-rollout/` and `docs/photo-rollout-2026-10-07.md`: external
    Python setup, fresh capture receipts and verified comparison sheets.
    Its tools pass 25 tests; the detailed shot guide stays private. This is
    preparation, not a new building rollout or model-training job. The main
    lane publishes the tested preparation branch through its existing sign-in.
  - The second lane's sandbox cannot reach GitHub. The main lane pushes its
    branches and opens its pull requests; nothing of it goes straight to `main`.
  - Everything else is the main lane's.

## Ground pass — PR #408

`codex/ground-detail` has the verified ground pass, evidence records and matched
before/after pictures in `docs/ground-detail-2026-10.md`. The final review adds
bank/Capitol/stadium masks and reversible material assignment. Generative readers
must skip `gd`; the main lane owns that integration. It is not live yet;
PR #408 is published, with #407 (generated-surface reader exclusions) to merge
first. Checks and the owner’s visual review precede site publication. The four ground files
remain reserved to that branch until publication.

## What is next

`QUEUE.md` is 280 KB and mostly history. Its top-level headings, in order:
- DONE 2026-09-29: four defects the owner saw on the live site (names, roads,
  time switch, night windows).
- NEXT: downtown night fidelity from owner photographs (2026-09-21).
- Campus detail pass (shipped 2026-08-27), photo import real-corpus queue
  (R0 to R8, 2026-08-26), and older gauntlets that are marked merged or struck
  through.

The newest direction in the record is buildings rebuilt from photographs, held
to the "looks like the building in the photograph" bar with matched cameras;
see the Oct 1 and Oct 3 entries. The owner's open defect list is not in the repo;
do not guess it.

## Known traps (pointers, not copies)

- **Verification:** `scripts/verify/README.md` is the law. Screenshot twice and
  trust the second; take the minimum of interleaved timing reps, never one
  reading; quote the instrument's settings with every number; cancel the graphics
  auto-detect probe at the top of any test.
- **Disk:** committed screenshots multiply across worktrees. Scratch frames go to
  scratch, not `shots/`. `git worktree remove` and `prune` unregister without
  deleting bytes. See `CLAUDE.md` Disk section.
- **Self-merge hazard:** before merging, pull `main` and re-run verification on
  the merged result, and say so if the other lane's open PR touches the same file.
- **Photo-derived building files:** never write photo ids, who took a photo, or
  camera positions into them (`docs/photo-source-provenance.md`).

## Where the history lives

`docs/JOURNAL.md` indexes `docs/journal/2026-07.md` through `2026-10.md` (August
and September are split into parts). Newest entries are at the top of
`2026-10.md`. Old references such as "HANDOFF #68" or "HANDOFF section 8" in code
comments and docs point into those files; grep the number or heading there.
`journal/_manifest.tsv` and `scripts/split_handoff.py` prove nothing was lost in
the split.
