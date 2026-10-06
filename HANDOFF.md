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
- Last things merged (newest first): #388 Burdine Hall and the Norman Hackerman
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
    `scripts/bake_ground.py`, its one output `data/ground.geojson`, and
    `js/ground.js`. The main lane does not write these three until that lane
    hands them back in this file.
  - Everything else is the main lane's.

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
