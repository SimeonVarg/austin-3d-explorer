# QUEUE

Work that is agreed and specified but not started. Anything in here should be
pickable up by any lane without asking Simeon a question first — if it needs a
decision from him, it does not belong here yet.

Ordered by value. Take from the top.

---

## 0. DONE, not queued — the two biggest files were downloaded twice

Kept here because it is the measurement that reframed item 1, not because there
is work left. PR #35. `js/capitol.js` appended the Capitol's features with
`setData`, which replaces a source wholesale, so 612 Capitol trees re-fetched all
25,341 of the city's and 1,802 ground features re-fetched all of
`ground.geojson`. **38.36 MB → 28.41 MB, 25.9% of a first-time visitor's
download, on the wire twice.** `updateData({ add })` appends a diff instead.

The cache does not save you and this is the part worth remembering: the two
requests **overlap in flight**, so there is nothing cached yet to serve the
second from. Verified against GitHub Pages' own `max-age=600` — the duplicates
still report *0 from cache*. An in-flight duplicate is never cacheable.

---

## 1. Vector tiles — add detail without making the site slower

**Why.** A visitor to the site downloads **26.4 MB across 26 files** (3.8 MB
gzipped) before anything is drawn, and every one of those files is the *whole
city*, fetched whether or not the camera can see it. That is the ceiling on how
much detail this project can ever have. Adding a nicer roofscape, more props,
more trees currently means a slower first paint for everyone — so "make it more
detailed" and "make it load fast" are in direct opposition.

Vector tiles break that trade. The data is cut into small tiles up front and the
browser fetches **only the tiles under the camera**. Detail stops costing load
time, which is the point: it is the one change that lets the city keep growing.
There is no cloud service that does this for you — the site renders entirely on
the visitor's own device, so the only lever is what gets sent.

**The half-built part.** `scripts/tile.sh` already exists, is already step 3 of
the documented pipeline in `scripts/README.md`, and already runs in
`.github/workflows/build-data.yml` (which builds tippecanoe from source to do
it). It writes `data/snapshots/<date>/austin.pmtiles` — 0.61 MB against the
1.41 MB `buildings.detailed.geojson` the app actually loads.

**Nothing in `js/` or `index.html` references that file.** The pipeline has been
producing it, and CI has been spending build minutes on it, for weeks.

**THIS IS NOT THE ONE-EVENING JOB THE ABOVE MAKES IT SOUND LIKE.** That was the
first draft of this entry, written from file sizes before reading the load path.
Reading it turned up three blockers. They are all solvable; none of them is
solvable quickly, and a lane that starts by adding a `pmtiles://` URL will get a
grey city and not understand why.

**Blocker 1 — the app enriches the whole city in the browser, all at once.**
`loadScene()` in `js/app.js` fetches the entire building collection and then runs
passes over it that need to see every feature simultaneously:

- `quantiseFacades()` (`js/facades.js`) clusters window colours across all ~3,000
  buildings and keeps the **14 most populous** tones, plus a protected list. Per
  tile this is incoherent: a tile of West Campus and a tile of downtown would
  each elect their own 14, and the shared atlas would no longer match the
  geometry. This is the hard one.
- `mergeCapitolScene()` splices in 604 Capitol buildings and 13 parts, and
  patches 12 existing ones from `capitol_overrides.json`.
- `applyUnion24()` rewrites Union on 24th's footprint to cut its courtyard.
- The label pass stamps `lbl` and `lt` after de-duplicating names against
  `signs.json` — a global comparison.

All of it has to move into the Python bake, *before* tippecanoe. That is the
actual project. Do it as its own change with the JS pass still in place and
assert the two agree feature-for-feature, then delete the JS pass. Do not do
both halves in one PR.

**Blocker 2 — tippecanoe is not installed on the Acer.** The archive is only
ever built in CI (`build-data.yml` compiles it from source). Nobody can iterate
on tiling settings locally until that changes.

**Blocker 3 — trees looked like the easy first target and are not, quite.**
`js/capitol.js` appends 612 Capitol trees to `austin-trees` at runtime. That now
uses `updateData`, which is a **GeoJSON-source API** — it does not exist on a
vector-tile source. Capitol trees would need either their own source and a
duplicated layer pair, or to be baked into the tree tiles upstream.

**So the order is:**

1. Install tippecanoe on at least one machine, or add a `workflow_dispatch` job
   that builds an archive from a branch so tiling settings can be iterated at all.
2. Port the enrichment to Python and prove parity with the JS pass. Biggest step
   by far; probably several PRs.
3. Tile `trees.geojson` first — 9.13 MB, the largest single file, 25,341
   fill-extrusion features with `base`/`h`, and the only client-side dependency
   is the Capitol append above.
4. Then buildings, using the archive `tile.sh` already produces.
5. Then `roads` 3.70 MB, `outer_ring` 2.59 MB, `roofscape.detail` 2.27 MB,
   `props` 2.19 MB.

**Watch for.**

- `window.PATTERN_TILING` caps every patterned GeoJSON source at `maxzoom: 16`.
  That is the fix for the city-wide motion flicker and it must not be lost.
  `tile.sh` already writes `--maximum-zoom=16` so the cap bakes into the archive,
  but **verify with `scripts/verify/shimmer.mjs` before and after.** `zfight.mjs`
  cannot see this class of defect — it gates on a flat 3×3 neighbourhood and is
  structurally blind to texture crawl.
- **Tippecanoe simplifies geometry at low zooms by default.** That is a visual
  quality change, not a delivery change, and it is the one thing here that could
  make the city look worse. `--no-simplification-of-shared-nodes` and an explicit
  `--simplification` are the knobs; pin them and take a before/after screenshot at
  altitude before believing it is neutral.
- Property loss is **silent** — a missing key renders as a default colour, not an
  error. `bake_detail.py` writes `pid`, `final_height`, `base`, `lt` and the
  facade keys, all read by paint expressions. Assert named buildings by pixel.

**Measure with `scripts/verify/payload.mjs`**, and read its header first: two
earlier hand-rolled versions of that measurement were wrong in opposite
directions. File sizes on disk are not the payload, and content-length is not the
wire.

---

## 2. Point the timing scripts at hardware GL and re-run every A/B

**Why:** `chrome.mjs` now supports `VERIFY_GL=hardware`, but the 17 `*-perf`
scripts that were silently running on the CPU renderer have never produced a
trustworthy number. Every frame-time comparison in `HANDOFF.md` that came from
them is suspect.

**What:** add `gl: 'hardware'` (or run with `VERIFY_GL=hardware`) to each of
`arts-perf`, `drag-perf`, `facade-perf`, `ground-perf`, `ground-tex-perf`,
`moody-perf`, `outer-perf`, `perf`, `perf2`, `perf3`, `post-perf`, `roof-perf`,
`roofscape-perf`, `stadium-perf`, `tower-perf`, `westcampus-perf`, `light-perf`.
Then re-run the A/Bs that decided something and correct any conclusion that
changes. Note in `scripts/verify/README.md` that a headed run now defaults to
hardware.

**Do not** switch the ~100 pixel-assertion scripts. Measured: hardware and
software renderers differ on 26-42% of pixels, worst channel delta 192/255.

---

## 3. Name the remaining buildings from a real source

**Why:** 2,069 of 2,453 buildings have no name.
`scripts/name_buildings.py` already exhausted every offline source in the repo
and recovered 32. OpenStreetMap is mined dry — a different source is the only way.

**What:** scrape UT's official building directory
(`utdirect.utexas.edu/apps/campus/buildings`) and the Wikipedia list of UT
buildings. Firecrawl's free tier covers the fetch (YC student deal). The actual
work is matching directory entries to footprints by address or coordinate, which
no tool does for you. Write results into `data/building_names.json`, which
`js/app.js` already reads at load — **not** into the snapshot, which a re-bake
would wipe.

---

## 4. Two roofs are buried inside their own buildings

**Why:** `scripts/reseat_authored_roofs.py` reports them and deliberately refuses
to move them, because lifting a roof on a guess is how you end up putting DKR's
deck on top of a floodlight mast.

**What:** an unnamed building (`3fb4507f`) is 12.00 m buried and the Austin
Recreation Center 6.35 m. Work out why — most likely `final_height` changed under
a roof baked against the old value — and fix the cause rather than the symptom.

---

## 5. The zoom-change shimmer

**Why:** capping every patterned source at `maxzoom: 16` fixed the flicker while
flying (WASD is now at the floor), but a pure zoom change still crawls — 38.3%
against a 26.2% floor. Q/E shimmers while held.

**What:** the fade is driven by the display zoom crossing an integer, not by
which tile the geometry came from, so a source setting cannot reach it. The
plausible fix is two pattern tiers switched by zoom — a softened tile on a far
layer, the sharp one on a near layer. Costs about ten more atlas images and the
per-image repaint recurs on every time-of-day step, so measure before committing.

---

## 6. Verify suite on GitHub Actions, triggered from your phone

**Why:** two reasons, and the second one was under-sold the first time.

The obvious one: it gets the suite off your laptop, free. See `docs/CLOUD.md` §4.
A job cannot be left running, so there is nothing to forget and nothing to bill.

The one that matters more day to day: **it is what makes an agent session fast.**
A verification pass is ~10 browser runs at 1.5–3.5 minutes each, and they are run
**one at a time on purpose** — running eight headless Chromes at once is exactly
what put 38 orphaned processes on the machine and pinned it at 100%. Actions
runs them concurrently on somebody else's hardware, so the wall clock becomes the
slowest single script instead of the sum. That is the real fix for a half-hour
turnaround, and it costs nothing.

**What:** `.github/workflows/verify.yml`, `workflow_dispatch` so it is a button
in the GitHub mobile UI — copy the shape of `build-data.yml`, which already
carries the "Phone-friendly: trigger this from Kiro / the GitHub mobile UI"
comment.

- `ubuntu-latest`, GitHub-hosted. **Not** self-hosted — this repo is public and a
  self-hosted runner would let a stranger's pull request run code on your machine.
- `CHROME_PATH=/usr/bin/google-chrome`; `chrome.mjs` already probes that path, so
  no code change is needed.
- `python -m http.server 8123` and `VERIFY_URL=http://127.0.0.1:8123` — the
  README records that three agents once served on 8099 from different worktrees
  and requests went to whichever bound first.
- Matrix-shard the scripts so they run in parallel. Wall clock becomes the
  slowest single script rather than the sum.
- Upload `scripts/verify/shots/` as an artifact, and put the pass/fail table in
  the job summary so it is readable on a phone without downloading anything.

**Blocked on:** the "page is not defined" regression — 15 scripts still crash
instantly. Wiring broken scripts into CI just teaches you to ignore red builds.
That fix is the Mac lane's.

**Check first:** the free plan caps concurrent jobs (commonly cited as 20). Do
not design a 40-way matrix before confirming it.

---

## 7. Turn on Greptile for pull-request review

**Why:** this reverses an earlier call. `docs/CLOUD.md` ruled Greptile out as
"built for a team's pull-request volume". That missed the actual situation: two
AI lanes both edit `js/app.js`, and Simeon merges pull requests he cannot fully
read. An independent reviewer on every PR is a genuine second pair of eyes, not
process overhead. Free for a year on the YC student deal.

**What:** install the GitHub app on this repo, confirm it comments on an open PR,
and note in `CLAUDE.md` that its review is advisory — a lane still owns its own
verification, and a green Greptile comment is not a substitute for looking at the
render.

---

## 8. Split HANDOFF.md

**Why:** it is ~91 KB and every session reads all of it. Simeon has already
approved this as an idle-time chore.

**What:** a short current-state file plus `docs/JOURNAL.md` for the history.
Keep the hard-won rules (the numbered list at the end) in the short file — those
are the part that stops mistakes repeating.

---

## 9. The Drag renders near-WHITE at night

**Found 2026-08-01 by `scripts/verify/night-pale.mjs` (new). Characterised, not
fixed.** I spent a long time on it and every theory I had was wrong, so this is
exactly what is established and what is not, rather than a guess left in the code.

**The defect.** At night the Guadalupe streetwall — the Co-op, Chipotle, the
shopfront strip — renders as a row of pale blocks against a black city. See
`shots/tour/night-the-drag.png`. This is the inverted-silhouette failure, and it
is the most visible kind of bug this scene has: one wrong building in a night
frame takes the eye before anything else.

**Measured.** `night-pale.mjs` hides one pass at a time and counts pale pixels
below the horizon, because counting bright pixels tells you there is a problem
and not where it lives. Of 3146 pale pixels at the DKR pose, `drag-*` accounts
for **55.8%** and `drag-wall` alone for 31%. Nothing else is close — `stadium-*`
16%, everything else under 2%.

**Established, all measured, none assumed:**

- `drag-wall` paints with `fill-extrusion-pattern`, a baked image. A pattern does
  not respond to the time-of-day colour ramp; only re-uploading the image does.
- The Drag DOES register a retint hook: `window.__dragTodHooked === true`, and
  `applyDragColors` exists as a function.
- Its six families are `pclCoffer, gymArcade, uniArcade, uniWin, retUpper,
  shopGlass` (`dragTileAudit()`).
- Calling `applyDragColors(map, 0.95)` **by hand** takes the pale count from 6206
  to **1904**, and it then stays stable.
- Waiting never does it: 24209 px at +2 s, 6208 at +6 s, and **6208 at +12 s and
  +20 s**. It is not slow propagation.
- Instrumenting `map.updateImage` across a real slider retint records **120 calls
  and not one of them is a Drag family.** Tower (`tw*`), arts and moody tiles all
  update. The Drag's do not.

**So the hook is installed and the tiles are still never re-uploaded.** Those two
facts together are the whole puzzle and I could not reconcile them.

**Tried and reverted — do not repeat these:**

- a second tile-push pass on `requestAnimationFrame` — no change, 6206
- a second pass on `map.once('idle')` with a 2.5 s timer fallback — no change;
  `idle` fires about a second in, well before the +6 s plateau
- three timed retries at 1200 / 4000 / 8000 ms — no change
- adding a `setPaintProperty` write alongside each retry, on the theory that it
  forces the pattern atlas to rebuild — no change

A fix that does not move the number is worse than no fix, because the comment
above it will be believed.

**Where to start.** The gap is between "the wrapper is installed" and "the
`updateImage` calls never happen". Log inside `applyDragColors` itself during a
real slider drag — **not** from `page.evaluate`, which is the one path already
known to work and therefore proves nothing. Six passes wrap
`window.applyTimeOfDay`, and the comment at `js/drag.js:805` already records that
the `__drag` marker is unreliable for exactly that reason. Suspect the wrap chain
before suspecting MapLibre.

**While in there:** `stadium-*` is 16% of the pale pixels, and
`data/stadium.geojson` has 499 of 511 features with no night colour at all
(`westcampus.geojson`: 109 of 145). Those may be handled by a `SOLID`-style
lookup keyed on surface — `js/westcampus.js` does exactly that — or they may be
the same bug wearing a different hat.
