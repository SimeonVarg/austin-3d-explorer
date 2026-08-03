# MAC LANE — the trees, and only the trees

Written 2026-08-02 afternoon. This lane exists again after a day off it, and the
scope is deliberately narrow: **one script, one data file, one archive.**

## Why the boundary is drawn here and not somewhere else

The last two-lane split was cut by an ad-hoc list of files and it ran straight
through the middle of a subsystem — the Acer needed `js/facades.js` for the
buildings-on-tiles port while this lane owned it, so finished work sat parked and
the same discovery got written into `HANDOFF.md` twice from two machines.

**The split that works is by BAKE.** Every bake script owns exactly one output
file and nothing else writes it. Five parallel workers have been running on that
boundary all night with clean merges every time. So:

| you own, completely | the Acer will not touch it |
|---|---|
| `scripts/shape_trees.py` | |
| `scripts/fetch_city_trees.py` | |
| `data/trees.geojson` | |
| the `trees` layers in `js/app.js` | *only* the tree paint expressions |
| `data/tiles/trees.pmtiles` | |

**You READ `data/ground.geojson` and must not write it.** The Acer is editing it
continuously. The three corridor tags you need — `src:'creek_canopy'` (33
areas), `src:'creek_under'` (34) and `src:'creek_scrub'` (49) — are already in
the shipped file and their schema is frozen for you. If you need a fourth, say
so in `HANDOFF.md` and the Acer will add it.

**You merge your own PRs.** Branch `mac/*`, verify, `gh pr merge --merge
--delete-branch`. **Never merge red.** Never wait for Simeon.

---

## The three traps that keep costing hours

1. **`python -m http.server` cannot test this site.** It ignores `Range:`, which
   PMTiles needs, so every feature in a tiled layer silently vanishes with **no
   console error** — and trees are tiled, so this trap is aimed directly at you.
   A treeless campus was once photographed and briefly believed.
   Use `python scripts/serve.py 8123`.
2. **A missing layer makes every metric look BETTER.** Payload down, frame time
   down, everything reads as a win. **Verify with a picture.**
3. **Run `node scripts/verify/harness-drift.mjs` before trusting any pixel
   measurement.** `_harness.html` is a hand-maintained copy of index.html's
   script list and it was missing `js/tiles.js` until today — every night-pale
   run and luma probe for an unknown number of passes measured a city with no
   vector tiles. It is fixed and now guarded. Keep it passing.

**Tools:** `scripts/verify/pose.mjs` photographs any pose from the command line —
`--out shots/x --tod 0.30 name:lng,lat,zoom,pitch,bearing`, and
`--extra "&tiles=0"` forces the GeoJSON fallback so you can see a data change
before paying for a re-tile. `tour.mjs` needs `VERIFY_MAX_MS=900000`.

**Re-tiling:** `gh workflow run build-tiles.yml --ref <your-branch>`, then
`gh run watch <id>`, then `git pull --rebase`. About 20 seconds; it commits the
archives back to your branch.

**`shape_trees.py` is IDEMPOTENT** — it merges crown tiers back before
re-tiering, so running it twice changes nothing. Keep it that way.

---

## T1. Every tree is a stack of flat discs

**The biggest remaining eyesore in the scene.** 57,548 trees, and past about
z16.5 every one of them reads as a wedding cake: 3–5 octagonal tiers, all the
same flat olive.

PR #59 gave the species their SILHOUETTES — live oak wide and low, cedar elm
taller and narrower, a conifer, a small ornamental — and that part is right. What
is missing is SHADING. A real crown is dark underneath and catches light on top,
and nothing in this scene expresses that, so the tiers read as separate objects
stacked up rather than as one mass of foliage.

- Give the tiers a value gradient: lower tiers darker, upper tiers lit.
- Consider a small per-tree hue jitter so 57,548 trees are not one green. Keep it
  SMALL — this is a stylised city and a rainbow forest is worse than a flat one.
- If the paint expression needs a tier index to key off, bake it in
  `shape_trees.py` rather than deriving it in the browser.
- **Measure the cost.** `trees.geojson` is 23 MB and the largest file in the app.
  Report features and KB before and after; if a gradient costs a fifth tier
  everywhere, that is a real payload decision and it belongs in the PR.

**Parameterise the ramp** (CLAUDE.md rule 11) so Simeon can flatten or deepen it
in one line.

## T2. The canopy stops dead at the campus edge

West Campus, East Austin and everything south of the Capitol are bare tan. Austin
reads as a dust bowl with one green island in it, and it is the first thing you
notice from any altitude.

**Look in `data/osm_cache/` FIRST.** There is already a `city_trees.json` and a
`trees.json` in there, and a previous session left a much wider fetch cached
under a bbox-named file (roughly 30.24–30.315 N, -97.788 to -97.702 W — most of
central Austin, far beyond campus). If the coverage is already on disk this item
is a filter fix, not a fetch, and that changes it from hours to minutes. Check
before you reach for the network.

**Then find out WHY before fixing it.** Three candidates, each needing different
work:

1. the fetch bbox in `fetch_city_trees.py` is drawn tight around campus
2. the City of Austin tree inventory genuinely does not cover those blocks
3. something downstream filters them out

Report which it is. If it is (1) this is a data fetch — check the network is
actually reachable and **say so plainly if it is not** rather than synthesising
coverage and calling it done. If it is (2), then scattering plausible street
trees along the road network is a legitimate answer, but it must be labelled
GENERATIVE in the bake's provenance output, the way the other bakes label theirs.

Watch the payload. Doubling the tree count doubles the biggest file in the app.
Tiles make that survivable but not free — measure it.

## T3. Waller Creek has no trees in it

The Acer cut the channel (PR #79) and authored the three planting zones, and then
never grew anything in them. **The hook is sitting in the shipped data unused:**
33 areas tagged `src:'creek_canopy'`, 34 `src:'creek_under'`, 49
`src:'creek_scrub'` in `data/ground.geojson`.

Consume them. Canopy gets full-height trees at real spacing, understorey gets
smaller crowns, scrub gets low mass. Simeon on this stretch:

> "the creek behind patton and alumni is a very vibrant in depth creek, samd
> with the area behind san jacinto and the rec center and the track that area
> also very lush. Hope you will add more detail there and not the bare minimum"

**Photograph both of the stretches he named** — behind Patton Hall and the
Etter-Harbin Alumni Center, and behind San Jacinto / the Rec Center / the track —
and put both in the PR. Note that `tour.mjs`'s `waller-creek` pose does not
actually contain the creek; the Acer owns that file, so report it rather than
editing it.

---

## Order

T3 first — it is the smallest and it proves your re-tile loop works end to end.
Then T1, which is the biggest visible win. Then T2, which is the one most likely
to turn into a data-availability problem you cannot solve, and you should not let
it block the other two.

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.** 38
   orphaned Chromes once took a laptop to 100% CPU mid-deadline.
3. **Never leave a browser or a server running.** `node scripts/verify/reap.mjs`
   and kill your server before finishing every pass.
4. **Record every pass in `HANDOFF.md`** with the branch name — including what
   you tried that did NOT work. That is the most valuable part of this repo's
   history; see §31–38.
