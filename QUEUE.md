# QUEUE

Work that is agreed and specified but not started. Anything in here should be
pickable up by any lane without asking Simeon a question first — if it needs a
decision from him, it does not belong here yet.

Ordered by value. Take from the top.

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

**What.**

1. **Wire up what exists.** Add the `pmtiles` protocol shim (`index.html`
   already loads MapLibre from unpkg, so a second unpkg tag is consistent with
   how this repo does dependencies — do not invent a vendoring scheme for one
   file). Register the protocol before `map` is constructed, and point
   `austin-buildings` at `pmtiles://data/snapshots/<date>/austin.pmtiles` with
   `source-layer: 'buildings'`.
2. **Check the properties survived.** Tippecanoe drops or renames nothing by
   default here, but `bake_detail.py` writes `pid`, `final_height`, `base`,
   `lt`, and the facade keys, and every one of those is read by an expression in
   a paint property. A missing key fails *silently* as a default colour, so
   assert a few named buildings by pixel before believing it.
3. **Then tile `trees.geojson`.** It is 9.13 MB — the largest single file by 2.5×
   and more than a third of the payload. It is also 25,341 fill-extrusion
   features with `base`/`h`, which is exactly the shape tiling is good at.
   Extend `tile.sh` with a second invocation rather than writing a new script.
4. **Then the next four**: `roads` 3.70 MB, `outer_ring` 2.59 MB,
   `roofscape.detail` 2.27 MB, `props` 2.19 MB. Together with trees that is
   20 MB of the 26 MB.

**Watch for.** `window.PATTERN_TILING` caps every patterned GeoJSON source at
`maxzoom: 16` — that is the fix for the city-wide motion flicker and it must not
be lost in the move. `tile.sh` already writes `--maximum-zoom=16`, so the cap
comes baked into the archive, but **verify the flicker has not returned** with
`scripts/verify/shimmer.mjs` before and after. `zfight.mjs` cannot see this class
of defect; it gates on a flat 3×3 neighbourhood and is structurally blind to
texture crawl.

**Measure it honestly.** Record total bytes fetched at load before and after,
from the network panel, not from file sizes on disk. The win is only real if the
*visitor* stops downloading it.

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
