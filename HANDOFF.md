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

- The live site (flyover-utx.vercel.app) is built by the Vercel host from `main`
  only (#463); `deploy-pages.yml` also publishes `main` to GitHub Pages. Data
  snapshots arrive from `build-data.yml`. The host refuses builds when its daily
  limit is used, so "on `main`" is NOT "live": a merge is live only when its
  commit status says the host built it (or a later commit's does) and a changed
  file fetched from the live site equals `main`'s.
- Last things merged (newest first): #510-#514 v2 demo polish, LIVE at /v2/: v1's loading screen and opening flight, no horizon band and v1's haze, the light fixed (Standard view: no navy shade; fitted 4096 shadows), v1's apartment finder / importer / Explore menu with building names and a building card, filtered windows on the plain buildings; v2 loads in 5 s vs v1's 21 s and draws a frame 8x faster on the AWS L4 (journal 2026-10-18 night); open: the owner's eye in motion; #509 v2: the accepted UT Tower and the reviewed Moody Center in the tiles, DKR field green (see the journal 2026-10-18 evening); #508 and #507 the v2 app, LIVE at /v2/ (three.js r186, no MapLibre; 303 of 305 Blender builds as 81 streamed tiles, new DKR Memorial Stadium as a 60,000-triangle app copy; not linked from the main page; frame time on the AWS L4 holds 60 Hz, see the journal 2026-10-18; open: the owner's eye, 2 placement questions, lod1 of the stadium); #504 the Blender layer: one material a pass for its pictures and a one-pass lay, same picture; desktop +48 to +61 %, simulated phone +80 to +131 %; atlas memory unchanged (268-372 MB desktop); still OFF; next: 96 MB targets on the phone, then why sharing the thin parts' material darkens them; #503 the Blender layer's atlas: one shared smoothing target, render calls 90-120 -> 5-28 a frame, same picture; layer cost +47 to +63 % desktop (was about +100 %), simulated phone +99 to +129 %; targets now 210-410 MB; still OFF; next: one shared material per pass; #502 the Blender layer's cost is its per-building render calls (about 340 a frame); first cut merges 3 of 4 calls per building, byte-identical picture, saves up to 1.1 ms desktop / 2.9 ms simulated phone; still about 2x frame time, layer stays OFF; next: one atlas target for all buildings (`docs/gltf-layer.md` "What the layer's frame time is"); #501 light B for the Blender layer and rig (more sky light, brighter glass mirror; only with `?gltf=1`; the shared rig now builds under B; `?skyrig=a` is the old light); #500 33 more Blender builds in the layer, still OFF unless `?gltf=1` (122 in all; off, the app is unchanged; left out: two for flicker, three unproven cameras, Icon and the Music Recital Hall for their outlines, eight downtown builds on OSM outlines that need an outer-ring hide first; `data/gltf/` 40 MB); #499 the Blender layer's smoothing pass copies only what each building drew (frame time with the layer on about halved, page memory 1.9 to 0.8 GB; still about +60 to +140 % frame time in close views; layer still OFF unless ); #498 31 more Blender builds in the layer, still OFF unless `?gltf=1` (89 in all; off, the app is unchanged; left out: the courts tower for flicker, five unproven cameras; `data/gltf/` 30 MB).; #497 the Blender-building layer, OFF unless `?gltf=1` (58 Blender builds drawn in place of the buildings they replace; off, the pictures and the city are the same as before and the page loads two small table files more; turning it on for everyone waits for the owner's eye; open: shade brightness, frame time with many buildings in view, phone); #492 the rooftop scene pass: eight authored apartment sections (Rise at West Campus, Twenty Two 15, Noble 2500, Yugo The Corner, Quarters Nueces House, Texan Tower, 26 West garage and Rio Grande wing), rebuilt roof decks on The Standard, The Mark and Union on 24th, far houses and trees kept in rooftop views, a surface-aware near plane, and night windows for recipes with explicit openings (opt-in; `authored-night-windows.mjs`); about +0.8 MB download and +2.8% triangles at the opening view; likeness to the photographs and steady motion on the owner's Mac are still open; #491 the AWS GPU runner passes a quoted argument as one argument, and `;;` separates checks when an argument holds a comma (`scripts/aws-gpu/split-checks`); #490 optional whole-scene temporal filter, OFF unless `?framefilter=1` (building flicker 4 to 27% better, non-building flicker worse, about 5 to 12% more frame time: an experiment, not a default); #488 roof clay relief filtered before sampling, ON for everyone (roof-area flicker about 40% lower, no consistent frame cost); the moire goal is still NOT met; open fault: the hidden name of Regents West at 24th answers a click; #489 the AWS GPU launch waits and tries again (up to 6 minutes) when the account's vCPU limit is still held by a machine that is shutting down; #487 the sunlight shader skips shadow reads where sunlight adds nothing (pixels equal on Intel and NVIDIA), and optional `?packmerge=1` stores identical packed vertices once (about 25% less packed storage; OFF by default; a small timing trade, not a no-overhead result); the still and moving moire goal is NOT met; #484 photo tools: full source inventory, reviewed packets, camera checks in the real app, overlap matching (`scripts/photo-rollout/README.md`); camera math version 2 is opt-in and older saved cameras are unchanged; #486 the AWS GPU launch carries a check's arguments to the machine unchanged (base64 check list, literal template filling, `launch --print-user-data`, a round-trip case in `test-offline`); #485 the AWS GPU run is green only when the machine's own record says every check passed (`scripts/aws-gpu/outcome.py`), and a check's name is one flat safe folder; #446 Domino's from the photographs (`scripts/author_dominos.py`); #482 `schedconfirm.mjs` waits for the router and prints why a pair did not route; #483 picture checks stop failing by chance (`tile-heal.mjs` waits for a finished frame; `packverts-pixels.mjs` and the before/after pictures hold the sky clock with `skyfreeze=0`; no limit changed); #481 AWS GPU results really come back (the machine id is read from the `"InstanceId"` field; an empty fetch fails the run; proven by run 38109104743); #461 Norman Hackerman Building east block from the photographs (window pairs with hoods, deep dark arcade, 8 m louvred sunshade; `scripts/author_hackerman.py`; the blocky shade patch under the sunshade is the shadow map, not the model); #445 Jimmy John's from the photograph; #476 the frozen-redraw check and `?skyfreeze` (night pictures were noisy because bloom without the exposure read does not redraw identically); #480 the AWS GPU workflow fetches only its own run's results and no longer reads red on a listing; #477 signs are smooth outline lettering (Raising Cane's fixed; `sign-lettering.mjs` freezes the dot font to 12 older recipes) and `packverts-pixels.mjs` no longer fails on night noise; #475 the sky and fog are placed only when the layer order changed (one `addImage` 4.8 -> 0.7 ms); #433 Raising Cane's on the Drag has its own recipe from the photographs; #473 packed vertices on for every tier (16-byte vertex with a tone table; phone-profile peak memory 1,199 -> 978 MB, GPU upload 186 -> 69 MB; about a fifth faster frames on the owner's Intel graphics; `?packverts=0` restores the old layout; the Rust builder is in the tree and OFF); #438 wall images are painted when a tile first asks, the opening flight's set warmed behind the veil (city ready about 2.4 s sooner at 1x, about 6 s at 4x CPU; no burst over 50 ms after the reveal; `?walltiers=0` restores eager painting); #472 the bus in the finder (the trip drawn on the map, the class-day bus in every ranking row, a "Show live buses" switch, a bus row in the walking pathfinder; `js/finder-bus.js`); #470 the whole city, measured: 39,820 outer houses with roofs and 196,109 trees (`js/outer-homes.js`, `js/outer-trees.js`, two `.bin` files) and downtown shapes from the 2021 laser scan; outer files 340 KB smaller; phones get the biggest 15% of houses and no outer trees; `outer-count.mjs` guards that no case draws less than before; #465 whole-app look check, 49 interface fixes seen at three widths (report and the owner's 12 taste sheets in `docs/visual-audit-2026-10-10/`); #463 the site host builds `main` only (work branches no longer use up the daily build limit; a merge is live only when its commit status says the host built it); #434 the apartment finder opens as a pill and shows a live bus line under a selected home (CapMetro public feed, schedule stays on the device, `finder-egress.mjs`), with the 13 bus review fixes; #432 GDC entrance 165 and EER entrance 333 re-seated on their walls (`bake_entrances.py --reseat-entrances-only`); `wallplane.mjs` is on again; 12 other doors still sit off their walls (listed in the journal) (Oct 10). #428 DKR west face rebuilt to the rule of the near-frontal photograph (13 bays of 12 m, one tall ribbed panel with slit windows per bay, hoods, flutes, narrow pylon; check 1a in `docs/photo-audit.md`) (Oct 10). #430 live bus module (`js/transit-live.js` reads CapMetro's public feed in the browser, `data/transit-live.json` baked slice; the finder loads it since #434; `docs/transit-live.md`), #429 route search (`js/transit-route.js`: walk + bus + walk, one transfer, ranges; the finder uses it since #434), #431 six quarantined checks back on (coplanar baseline moved: downtown pairs not yet looked at in a render) (Oct 10). #427 the pictures in the checks show a finished city (walls painted at once with `facadepace=0&timeofdaypace=0`; day views now move 0 % with no change, so a flag on a day view is a real change; tower-night stays noisy) (Oct 10). #426 DKR stadium's four north stair towers are round brick towers (brick piers, dark glass strips, pale ledge, glass ring, rim and cap box; places and sizes from the laser scan, the stack from the owner's photograph; lower bodies and the two north-east towers inferred; `STADIUM_MESH.roundTowers`) (Oct 9). #425 DKR west face, second pass: the window bands were hidden behind the wall sheet by day; the wall is drawn around them and the bands are dark; check 7b in `docs/photo-audit.md` (Oct 9). #424 DKR stadium west face from the owner's photographs: cream solid wall with proud piers, ribbed panels, window bands and a centre pylon (`STADIUM_MESH.west`; bay width and level heights inferred; the other three faces, the upper deck and the brick stair towers are not done) (Oct 9). #423 Welch Hall's newer wing, west wall: terracotta lattice screens, slit windows and a lighter top storey from the owner's photograph (sizes approximate) (Oct 9). #422 Welch Hall west entrance (stone surround, framed window above, landing and steps; sized from the flattened photograph, placed from the laser scan) (Oct 9). #420 Welch Hall outer walls from the owner's flattened north wall photograph (window 1.55 x 2.8 m, bays 2.9 m, limestone base with tall windows) and the north CHEMISTRY entrance with steps; a colour written as a bare string no longer stops a building from being drawn (Oct 9). #419 AWS GPU runner: results and the log always come back (the owner's setup is done; the first run started with no key and stopped itself but returned nothing, which this fixes) (Oct 9). #413 Moontower rebuilt from the laser scan and flattened photographs: low boxes in front of both wings, tiers of three floors, glass strips, corner glass box on the notch corner (`scripts/author_moontower.py`; west, south and north walls inferred) (Oct 9). #418 Welch Hall to the laser-scan height, 20.3 m (was 18.2 m), storeys 4.73 m, 13 bays on each east face; new recipe option `roofBase` lifts kept campus roof pieces with the walls (Oct 9). #366 AWS GPU runner: a keyless setup stack (`scripts/aws-gpu/setup-stack.yaml`) and a hand-started workflow "AWS GPU checks" (Oct 8; first real run Oct 9, see #419; `scripts/aws-gpu/README.md`); #417 Welch Hall courtyard, second pass: the terrace's west end is a balcony, single windows on the west court wall, one small shrub, all from a camera fitted to the photograph's window corners (Oct 8, 18 CI checks, every job run). #416 Welch Hall courtyard, first pass: the old wing's court walls get pairs of windows in three rows over a stone base (Oct 8, 18 CI checks, every job run; `old_wing()` in `scripts/author_welch_courtyard.py`); #415 brick in mixed tones: a tone per brick and soft areas that show from far away (Oct 8, 18 CI checks, every job run; `?brickpatch=0&brickmottle=0` shows the old flat brick); #414 Welch Hall east wall: three window rows with stone bars, the photographed arch shape, 4.2 m bays, measured colours (Oct 8, 18 CI checks, every job run; a band may now carry its own `floors`); #412 the same arches continued through the middle stretch of that wall (Oct 7, 84 CI checks, every job run); #411 round arches on the south part of Welch Hall's east arcade (Oct 7; all 84 CI checks passed; seen on the live site from the photograph's camera the same day); #410 photo-rollout tools (not part of the site); #409 a local reference-viewer helper (a Mac tool, not part of the site); #408 ground detail across campus and West Campus and #406 campus roof tiles visible at middle distance (both checked on the live site, Oct 6); #407 bakes skip the generated ground patches; #388 Burdine Hall and the Norman Hackerman
  Building with the compact wall material (Oct 2-3); #383 2400 Nueces and #379
  Ion Austin, the two buildings from street photographs that passed the owner's
  look (Oct 1); #369 the city comes back after the browser loses its graphics
  context; #354 desktop memory; #373, #375, #376 smaller fixes.

## Open pull requests (from `gh pr list`, 2026-10-04; merged and closed rows removed 2026-10-10, newer ones are not listed: run `gh pr list`)

| PR | Branch | State |
|---|---|---|
| #348 | `claude/sky-roll` | open: sunset sky glow follows camera bank |
| #347 | `claude/loading-fit` | open: loading screen fits one phone screen |
| #327 | `claude/speed-shaders` | open: shaders start compiling at second one |
| #320 | `codex/baked-enclosure-layer` | draft: optional baked enclosure shading |
| #312 | `codex/compiled-building-lifecycle` | draft: guarded compiled building lifecycle |
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
    `js/slopes-roofs.js`, `js/slopes.js`, `js/city-lighting.js`. The
    roof look at middle distance merged as #406 (Oct 6).
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
    lane published it as #410 (Oct 6).
  - Check the session's own tools and sign-in before you assume a lane is blocked. On October 11 the Mac
    Codex lane pushed #484 and #487 itself and merged #484 through the existing GitHub connection, with no new
    sign-in. An old sandbox failure is history, not a lasting limit. File ownership, the checks and the
    pull request rules still apply.
  - Everything else is the main lane's.

## What is next

**NEWEST, 2026-10-12, said by the owner to the publishing lane: the project is reframed around Blender** (`CLAUDE.md`
rule 16 has his words and what it means for every lane). State at 15:15 that day:
- **Buildings:** six Blender builds from one site photograph each exist privately (a 30-storey tower he scored 9 of
  10; a painted mid-rise and a brick campus building he put "between 8s and 9s"; three more not scored yet). None is
  live. More are being built, apartments first. The brick campus building has no proven name or outline yet.
- **In the app:** draft #496 (`mac/gltf-layer`, `?gltf=1`, off by default) draws the tower and one more building from
  model files; with the app's present shader he scored the tower 7.5. Its one failed check was `tile-heal.mjs`
  ("the instrument is steady"), which also failed on another branch before: flaky, not weakened, not fixed.
- **Renderer:** `mac/blender-look` holds a test page that draws the tower live with the Blender look. The step now
  being built puts that light inside the app and measures the frame time WITH the whole city, which is not known yet.
  After that: the phone. No full rebuild has been ordered; the route is "new light for Blender buildings in today's
  app first, then the rest of the city in steps".
- Not merged, not live: everything above.

**Still true from 2026-10-11:**

The owner's direction of 2026-10-11, in the order the photo lane reported it (now behind the Blender decision above):
1. **Photo-matched whole views first:** campus, east and north Austin as seen in his rooftop photographs, with the
   apartments and distant buildings that are missing. First pass merged as #492 (eight sections, three decks); the
   whole views do not match the photographs yet.
2. **Then exact roof decks** on three West Campus towers.
**Newest, 2026-10-11 evening, as reported by the photo lane (not yet confirmed to the publishing lane):** direct
building of scenes by the large GPT model is STOPPED. The rooftop pass (#492) is live but NOT accepted as the result.
Next is a minimal-spend pipeline with small models that covers every imported photograph and every visible region of a
scene, with several views as reference and an independent critic that looks only for what is missing. First the lane
delivers the saved before / after evidence.
State of that pipeline at the end of 2026-10-11: a private pilot only (one photograph read tile by tile, 185 fragments;
the critic not yet run in full; no building made through it; NOT validated end to end). Instructions: `AGENTS.md`.
Root causes it answers: the old audit tool skips ground, planting and sky; the old photo records hold only the main subject.

3. **Moire is NOT accepted, and it stays a requirement inside that work, not a separate project on the photo budget.**
   On his Mac the apartments in the opening flight still shimmer severely. #488 (roofs) and the optional #490 did not
   meet his bar, and blur can not stand in for a sharp, steady picture in motion. Acceptance is his eye on the real Mac
   in the opening flight and in slow rooftop pans. A numeric gate that passes is evidence, not acceptance.

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
