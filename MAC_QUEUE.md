# MAC LANE

Rewritten 2026-08-02 morning, from Simeon's second list. Everything above this in
git history is superseded. M1 (DKR) and the LOD roof-cap bug are closed — the
roof-cap fix was exactly right.

**You merge your own verified work and resolve your own conflicts.** Never wait
for Simeon. **Never merge red** — if an item cannot be made to pass, close the PR
or leave it open with the reason written down, and move to the next item.

**The Acer owns `js/props.js`, `js/ground.js`, `js/tower.js`, `js/controls.js`,
`scripts/bake_art.py`, `scripts/bake_ground.py`, `scripts/bake_depth.py`,
`scripts/bake_roofs.py` and `scripts/shape_trees.py`** and is working all of them
right now. Stay out of those.

**You own `js/facades.js` this round.** The Acer has a campus facade bake parked
unmerged and is waiting on you — see M2 and M4.

---

## The three traps that keep costing hours

1. **`python -m http.server` cannot test this site.** It ignores `Range:`, which
   PMTiles needs, and every feature in a tiled layer silently vanishes with **no
   console error**. Use `python scripts/serve.py 8123`.
2. **A missing layer makes every metric look BETTER** — payload down, frame time
   down, everything reads as a win. **Verify with a picture.**
3. **Assert the effect, never the intention.**

`tour.mjs` needs `VERIFY_MAX_MS=900000` — twelve poses exceed the 300 s default
watchdog and it dies at pose 8 with no warning. `pose.mjs` (new) photographs any
pose named on the command line.

---

## M1. Windows are blurred, everywhere

*"i dont like how windows in general are super blurred"*

**Top item. It is the single most-seen surface in the scene** — every building in
every frame — and he raised it unprompted.

`js/facades.js` draws each pattern into a 64 px canvas tile and hands it to
MapLibre as a `fill-extrusion-pattern`. Candidates, roughly by how likely each is
to be the whole answer:

1. **Tile resolution.** 64 px stretched over 30–60 m of wall is a couple of
   pixels per window. Try 128 and 256; measure the look AND the atlas cost.
2. **`devicePixelRatio`.** A tile authored at 1x and composited at 2x is soft by
   construction.
3. **Mipmap / minification filter.** If MapLibre samples a downscaled mip at
   flying distance, that explains "blurred at every zoom" rather than "blurred
   close up".
4. **The tile's own drawing.** Anti-aliased 1 px strokes on a 64 px grid are mush
   before anything else touches them.

**Measure before choosing.** Photograph one wall at three distances, crop to the
same wall in pixels, and put the candidates side by side.

## M2. Downtown is bland, and one window column renders per tower

*"alot of downtown is super bland - make it look nice like the campus ... get
data on all the buildings and stuff, parks and cool things in downtown and add
them. also sometimes like one window column renders per downtown bulidng and its
really bad"*

**M2a — one window column per tower.** A pattern-scale failure, not a data
failure. `fill-extrusion-pattern` is TILE-anchored and its world size halves at
every integer zoom; `window.PATTERN_TILING` pins the GeoJSON sources to z16 and
`--maximum-zoom=16` pins the archives. A tower getting one column is being drawn
where the tile covers its whole facade. **Reproduce it first** — it is
intermittent, so find which zoom and which building class — then fix the scale
rule.

**M2b — finish the tile switch, which is still inert.** PR #71 baked the tower
buckets as `fb` and proved parity 114/114; PR #73 stopped it colliding with `wp`.
**Nothing renders differently yet.** Your own three steps still stand: expose
`registerOuterTowerBuckets` in `js/facades.js`, call it from `js/outer.js` before
`addSource`, re-tile `outer.pmtiles`. **One PR, or it stays inert.**

**M2c — real downtown data.** He is right that it should be easier than campus.
Overture has heights and classes for everything; OSM has the parks, plazas and
transit — Republic Square, Waterloo Park, the Central Library, the Moody Theater.
Distinct tower crowns, setbacks, podium bases that differ from their shafts,
ground-floor retail on the main streets. **The recognisable ones first** — Frost
Bank, the Independent, the Austonian, the Capitol view corridor — because a
skyline reads by its landmarks.

## M3. The far ring is a flat tan band at dusk

From the day/dusk/night sweep: the outer ring reads as a **solid tan wall with a
hard horizon line**, and it is the most unfinished-looking thing in all three.
`shots/tour/dusk-tower-south-mall.png`.

Two parts: the ring's colour does not recede with distance the way the near city
does, and the line where it meets the sky is hard rather than hazed. `js/sky.js`
and `js/outer.js` are both yours.

## M4. The 7,511 low-rise ring features still fall back to `mh00`

Named in your own `bake_outer_facades.py` header as what is not ported: they snap
to the CAMPUS palette, derived in the browser.

**The Acer has ported that derivation** — `scripts/bake_facades.py`, parked
unmerged on `acer/facade-bake`, transcribing `quantiseFacades` plus the whole
assembly it runs after (capitol overrides, the 604 appended features,
FACADE_PROTECTED, Union-24's colour rewrite). Parity harness written, not yet
run. When both halves are proved, the low-rise ring and the campus buildings move
onto tiles together. **Coordinate rather than duplicating it.**

## M5. Write `registerOuterTowerBuckets` so a second caller can use it

Once M2b lands, `js/facades.js` will have the shape the campus buildings need
too. Write it so a second set of buckets can be registered without copy-paste,
and say so in the PR — the Acer is blocked on exactly that.

## M6. DKR night, and the last 872 pale pixels

`night-pale.mjs` is down to **872** from 6,206. The only remaining contributor is
`stadium-*` at **12.4%**, all of it `stadium-detail`. **Confirm your DKR night
pass cleared it rather than assuming** — re-run the script.

## M7. Distant Horizons — the taste call is still open

`scripts/tile.sh` pins `--simplification=1`. Turn it up deliberately: 4, then 8,
then 12; rebuild via the workflow; shoot `tour.mjs` at each. Also try
`--drop-densest-as-needed` for trees and props — a live oak at z13 is four pixels
and there is no reason to send all 41,964 of them.

**Put the before/after shots in the PR and let Simeon pick the level**
(CLAUDE.md rule 9). Do not merge a level on your own judgement.

## M8. The verify suite on GitHub Actions

Still blocked on the dead scripts. **Each shard on its own runner** —
concurrency on one machine is only 1.5x and it manufactures false failures
(`retint.mjs` asserts a 2500 ms deadline, passes alone, fails three-at-a-time).
`run.mjs` carries a `SERIAL_ONLY` list; reuse it. `workflow_dispatch` so it is a
button in the GitHub mobile UI. `ubuntu-latest`, **GitHub-hosted only** — public
repo.

## M9. Kill the sleeps

**880 seconds of hardcoded `waitForTimeout` across 87 scripts** — about 15
minutes of every full run doing nothing. Worst: `drift-check` 48 s,
`lookup-check` 36 s, `srcprobe` 26 s, `arts-shots` 22 s.

**Per-script judgement, not a sweep.** A wait that could be a wait-for-ready is
free to delete; one masking a race becomes an intermittent failure, which is far
more expensive than a slow suite. Run each three times after changing it.

## M10. Name the remaining buildings

Lowest priority, safe to run last. Scrape
`utdirect.utexas.edu/apps/campus/buildings` and the Wikipedia list, match to
footprints by address or coordinate, write to `data/building_names.json` (**not**
the snapshot — a re-bake wipes it). Report a confidence per match and only write
what you would defend; a wrong name on a landmark is worse than no name.

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.** 38
   orphaned Chromes once took the laptop to 100% CPU mid-deadline.
3. **Never leave a browser or a server running.** `node scripts/verify/reap.mjs`
   and kill your server before finishing every pass.
4. **Record every pass in `HANDOFF.md`** with the branch name.
