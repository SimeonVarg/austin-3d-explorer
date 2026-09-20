# Handoff to Codex — 2026-09-20

Written by the Claude lane at the end of the preparation-and-repair round the
owner asked for before Codex resumes the visual work. Everything below was
measured; where something was not, it says so. Per-pass detail is in the linked
docs and in `HANDOFF.md`; this file is the index.

## 1. What production actually serves

`https://flyover-utx.vercel.app/` served **exactly `main`** when checked on
2026-09-19 08:36 UTC: `index.html`, all 49 `js/*.js`, the three stylesheets and
`data/apartments/index.json` were byte-identical to `main@c656249`
(`Cache-Control: public, max-age=0, must-revalidate`, `X-Vercel-Cache: HIT`).
A GitHub Pages deploy of the same commit also exists; the Vercel domain is the
one the owner uses and it was checked directly, not inferred.

**Not committed, and the owner's call:** a `.vercelignore` drafted in his own
checkout excludes `shots/ research/ scripts/ docs/ data/outer/ .github/ *.md`
(~750 MB per deployment). Verified by grep that nothing the running site fetches
lives there — every `shots/` and `scripts/` mention in `js/` is inside a comment,
and `data/snapshots/` (which `js/app.js:143` does fetch) is correctly kept.
A further ~118 MB is safe to add: `data/imagery_cache/ data/osm_cache/
data/dkr_aerial.png data/dkr_aerial_geo.png data/capitol_aerial.png` — no code
loads any of them.

## 2. Merged this round (nine PRs)

| PR | What it was, in one line | Doc |
|---|---|---|
| #270 | **Phones showed the old boxes.** Four causes, all reproduced on an emulated phone | `docs/mobile-real-buildings.md`, `docs/mobile-device-check.md` |
| #272 | **Campus was dark:** hidden buildings still cast shadows, and lit walls shaded themselves | `docs/dark-campus-diagnosis.md` |
| #269 | **Capitol:** the attic under the drum was on the wrong grid; the lantern was a cone | `docs/capitol-roof.md` |
| #274 | **Capitol:** the corner pavilions were taking the wings' pitch | `docs/capitol-roof.md` |
| #273 | **Waller Creek flickered:** the ripple surface's 0.10 m lift never reached the GPU | `docs/water-flicker.md` |
| #271 | **Interrupting the intro teleported you** to the flight's last frame | `docs/intro-interrupt.md` |
| #276 | **Render audit:** roof caps went flat from the air; graphics settings did not persist | `docs/render-audit-2026-09-19.md` |
| #268 | **Dobie Twenty21:** the WIP branch was mostly wrong; one correct part kept | `data/apartments/dobie-twenty21.json` |
| #277 | **Building heights are measured now**, from public lidar | `docs/massing-from-lidar.md` |

### The four things worth reading twice

1. **The phone fallback was lying, and it was sticky.** `js/mobile.js` cleared
   its crash counter only when the veil read `gone`/opacity 0, but `js/app.js`
   *removes* the veil, so the poll returned early forever and only a 120 s timer
   cleared it. Three ordinary visits + one reload put the counter at 3 and the
   third visit ran `slopes=0` — all 195 authored buildings back to prisms. Worse,
   the fallback was written into the URL, and `?lite=safe` skips the counter, so
   a reload or a bookmark trapped the phone permanently. Two more causes sat
   underneath: the 90 s `INTRO.authoredCeilingMs` turned `APARTMENTS` off for the
   visit (11 of 15 phone loads crossed it on a loaded laptop), and a lost WebGL
   context left MapLibre alive with the three.js layer dead — every authored
   building a hole. All four fixed. **The device gate is UNVERIFIED**: no iPhone
   was available. `docs/mobile-device-check.md` is the exact procedure.
2. **The intro fix found a deeper bug.** Moving the cancel from a DOM listener to
   the controller's takeover gave away a property the listener had for free: a
   listener cannot miss an event, a per-frame state read can. At 1.6–3.4 fps a
   full second of W was ignored in 2 runs of 6. `js/controls.js` now latches an
   accepted input and the tick consumes it. The deterministic guard is
   `key-tap-between-frames` in the 52-case matrix.
3. **Heights are no longer guessed.** `scripts/bake_massing.py` →
   `data/massing.json` measures height, ground and roof form from USGS 3DEP
   lidar (public domain, no key) for the model's buildings, with a trust flag
   from footprint overlap. 28 self-assertions, all green. **Nothing reads it
   yet** — wiring it into the renderer is a separate pass, and it is the single
   biggest accuracy win available. Ground across the model spans **136.5 m to
   186.2 m (49.7 m)**, so anything drawn on a flat datum is badly wrong at the
   edges.
4. **The owner's lighting direction is intact.** #272 fixed correctness only
   (shadow casters that were hidden, self-shading walls). No brightness,
   saturation or exposure change was merged. The measured aesthetic options are
   parked as reversible one-line comparisons in `docs/dark-campus-diagnosis.md`
   for Codex to choose from.

## 3. Night package (PR #275)

`docs/night-reference-package.md`, `docs/night-implementation-plan.md`,
`scripts/verify/night-compare.mjs` + `night-routes.json` (16 poses, 11 routes,
regimes day/golden/blue/twilight/early/night), and a baseline on `main`.

The measurements come from the owner's own 16 phone photographs (2026-09-18
19:23 → 03:06) plus 46 licensed night photographs collected and individually
inspected (`austin-reference-images/_night/`, local only). Headline numbers:
lit-window share 37–43 % early evening and 4–12 % at 3 am; lit windows cluster
by apartment, not at random (complete three-window groups lit 9× against 2.6
expected by chance); unlit walls hold Y .03–.07 in every regime while the sky
falls away, so a wall is 4–7× the sky early and ~30× at 3 am; lobbies and shops
run 1.5–4× the median lit window and warm; garage podiums and amenity bands are
cool (`#869aae`).

**Read the harness's history before trusting a number from it.** Five critics
ran against it; two found the same defect class this repo keeps getting burned
by — measurement rectangles sitting on the wrong subject. The last one proved
that at both Capitol poses the wall/ground/sky rectangles were measuring the
*basemap*: with the entire authored layer sabotaged away (3.56 M triangles → 0)
every number was bit-identical. `--break` now reports which measured numbers
moved per pose and flags a sabotage that moved nothing.

## 4. Reference coverage

- **Inventory: 553 buildings** reconciled from the loaded scene, the authored
  models, the profile collections, the snapshot footprints and the existing
  folders — campus 169, West Campus 177, Guadalupe 73, downtown 76, other 55;
  by model status: 269 legacy prisms, 148 profiles, 81 tile-only, 43 authored
  JSON, 8 heroes. `scratchpad/lanes/refs/inventory.json` (local).
- **Packs: 415 building folders** in `C:/Users/simip/Projects/austin-reference-images/`
  (local, git-ignored, ~1.4 GB), each with `notes.md`, `sources.json` (licence
  per file) and a labelled contact sheet. Third-party photographs are
  reference-only and are **not** committed.
- **Our model rendered from six angles for 559 buildings** (N/E/S/W oblique,
  aerial, street) with the exact camera in a manifest, so a discrepancy can be
  judged without launching a browser.
- **Still open when this was written:** the last research batches, the
  photo-vs-model discrepancy pass for ~36 of 97 batches, camera-pose validation
  in the app (0 done), and the published coverage index. The index and the gaps
  land in `docs/reference-coverage.md`.

## 5. The method change that matters most

Six scouts tested every way of getting references, each required to download
real bytes for the same ten test buildings. The write-ups are in
`scratchpad/lanes/sourcing/*/FINDINGS.md`, the decision in `PLAN.md`.

- **Massing, roofs and ground: solved, free, no account.** USGS 3DEP lidar +
  NAIP 30 cm imagery + City of Austin footprints returned usable data for 10 of
  10 test buildings, including an anonymous walk-up on Salado that has no
  photograph anywhere on the web (height 17.81 m, flat roof at 15.75 m with a
  parapet ring). This is what #277 now bakes.
- **Storeys, floor plates, year built: solved, free.** TCAD appraisal records and
  Austin permits. Stop reading storey counts off photographs.
- **Facades: the web does not have them.** Every public street-level set in
  Austin is a windshield camera pointed *along* the road: 14,797 KartaView points
  in the model area, and at the bar that is actually readable (<40 m, <35° off
  axis) that is **139 of 2,443 footprints — 5.7 %**. Nothing captured after 2019,
  so no recent building has any coverage. Wikimedia's UT series is excellent but
  covers 26 campus buildings.
- **So the highest-yield instrument is a $20 phone mount.** Phone sideways on a
  bike or car window, interval capture, one pass over West Campus (~6 miles,
  25–35 min, 1,500–2,500 broadside geotagged frames), then the same route at
  ~20:30 for the night corpus that this round proved does not exist online. It
  is also the only licence-clean facade source available: leasing photos, UT's
  own building pages and YouTube frames are all reference-only.
- **Do not** pursue Google Street View or Apple Look Around — their terms
  forbid this use outright (Maps Platform 3.2.3(c) names tracing building
  outlines), and do not mine YouTube (20 sampled frames across 4 videos gave one
  usable image).

## 6. Open, blocked or unverified

1. **iPhone check (#270)** — no device. `docs/mobile-device-check.md`. The design
   assumes a WebKit memory kill arrives with no `pagehide`/`visibilitychange`.
2. **`js/slopes.js` does not rebuild on `webglcontextrestored`** — the phone now
   reloads as a workaround; desktop still has the hole.
3. **Cell merging** (`acer/slim-cells` commit `701b953`, −393 k triangles on the
   phone arm) was **not** taken: the pixel check found single-pixel T-junction
   sparkles in 21 Rio's dark window bands. Re-try with T-junctions closed;
   `scripts/verify/mobile-mergecells.mjs` is the gate.
4. **`data/massing.json` is not wired into anything.** Next pass.
5. **Pre-existing harness flakes**, both red on `main` too: `movement.mjs`'s
   "glides to a stop" is a fixed 60-frame window and fails when the machine is
   *fast*; `js/slopes-arches.js:365` throws on page teardown, which makes any
   "no page errors" assertion randomly red. `zfight.mjs` could not load the scene
   with three lanes live — re-run it on a quiet machine.
6. **Intro, the veil race** — an input landing under the veil with no frame after
   it lets the flight depart and cancel ~300 ms in. A fix was written and backed
   out because the state could not be reproduced on demand; `docs/intro-interrupt.md`
   says what hook the next lane needs.
7. **Footprint identity is the next real bottleneck, not data.** 2 of 10 test
   buildings were missing from OSM by name and Jester matched the dining block
   rather than the tower. Heights are only as good as the footprint they attach to.

## 7. Recommended next task

**Wire `data/massing.json` into the renderer, footprint identity first.** Every
authored building currently carries a hand-estimated height and a flat-datum
ground; the file now holds measured values with a trust flag, and the ground
varies 49.7 m across the model. Do identity before geometry: fix the footprint a
building is attached to, then take the measured height where `trust` allows and
leave the authored value where it does not.

Second: the reference round's unfinished half (discrepancy pass, camera poses,
the coverage index), which tells you *which* buildings to model next and from
which photograph.

## Notes for whoever runs the lanes next

- Three machine-wide browser slots, taken with `scratchpad/lanes/gpu-run.mjs`.
  Parallel hardware-GL Chromes have blue-screened this laptop before.
- **Do not run `scripts/verify/reap.mjs` while lanes run in parallel** — it kills
  every harness Chrome on the machine, including other lanes'. It happened once
  this round and cost several runs.
- Pushing a branch that carries `scripts/**` changes can make `austin-data-bot`
  push a daily-snapshot commit onto *your* branch. Check after every push.
- Disk: 10 worktrees at ~1.1 GB each is most of the free space. Sweep them when a
  lane finishes; `git worktree remove` does not always delete the files.
