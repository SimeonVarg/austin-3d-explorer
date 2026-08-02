# MAC LANE

Rewritten 2026-08-01, late, from Simeon's own list, for an unattended overnight
run. Everything above this in git history is superseded.

**Goal: the site is fast and detailed enough to show AWS.** Work top to bottom,
one PR per item, on `mac/*` branches.

**You merge your own verified work and resolve your own conflicts.** Never wait
for Simeon. **Never merge red** — if an item cannot be made to pass, close the PR
or leave it open with the reason written down, and move to the next item rather
than stopping.

**The Acer owns `js/props.js`, `js/tower.js`, `js/controls.js`, `js/ground.js`,
`scripts/shape_trees.py` and the art/scene passes tonight** (QUEUE.md Parts A and
B). Stay out of those.

---

## The three traps that keep costing hours

1. **`python -m http.server` cannot test this site.** It ignores `Range:`, which
   PMTiles needs, and every feature in a tiled layer silently vanishes with **no
   console error**. A treeless campus was photographed and briefly believed. Use
   `python scripts/serve.py 8123`.
2. **A missing layer makes every metric look BETTER** — payload down, frame time
   down, everything reads as a win. **Verify with a picture** (`node
   scripts/verify/tour.mjs day` and `night`) before believing any number.
3. **Assert the effect, never the intention.** The Drag rendered white at night
   for weeks while `window.__dragTodHooked` reported `true`, because the flag was
   set two lines under the assignment that was missing.

**Minimum of interleaved reps, never one reading.** Load time here has measured
anywhere from 11 s to 65 s for an identical page on a quiet machine.

---

## Where things stand

| | start of tonight | now |
|---|---|---|
| visitor download | 28.41 MB | **12.08 MB** |
| time to city | 7.1 s | **5.6 s** |

Tiled: trees, roads, roof detail, props. MapLibre was running **one** tile worker
on 16 cores — now scaled. The Drag was rendering white at night — fixed, one
missing line (`QUEUE.md` item 9 history).

---

## M1. DKR — make it look like a stadium. Fiftieth time of asking.

**Top item. Simeon has asked for this repeatedly and it is still wrong.**

*"please make DKR look like a stadium for the 50th time - bug where field is
visible through north wall still there. But yeah want the entrance, and the
shops, accurate pillars and whatnot."*

**M1a — the field showing through the north wall. Fix this first and separately.**
It has been "fixed" before and is back, so the previous fix treated a symptom.
The field is a flat fill and MapLibre does **not** depth-test fills against
fill-extrusion — a fill composites over whatever is behind it regardless of 3D
position. A previous pass added a camera-angle gate (`NEAR_M`, pitch and centre
based) rather than solving that. Understand why the gate fails from the north
before adjusting its numbers again. **Screenshot from outside the north wall at
several pitches, day and night, and put the frames in the PR.**

**M1b — build the stadium.** Entrance, retail frontage, structural pillars, the
concourse. It is currently a bowl with a facade; it should read as a building you
could walk into. Use the reference the earlier passes used, and use the same
banded-feature approach `js/drag.js` uses for shopfronts — separate features with
their own base and height, never a pattern that tries to place something "at the
top".

**M1c — the night colour.** `data/stadium.geojson` has **499 of 511 features with
no night colour at all**, and `scripts/verify/night-pale.mjs` puts `stadium-*` at
16% of the wrongly-bright pixels after dark. Note DKR is *deliberately* floodlit
and reads correctly in `shots/tour/night-dkr-stadium.png`, so establish which part
of that 16% is actually wrong before changing data.

**Already checked, do not redo it:** every pass that builds a time-of-day wrapper
installs it — arts, drag, moody, outer, places, tower, westcampus all
`builds=1 installs=1`. **`js/stadium.js` never builds one at all.** That is the
thread to pull for M1c.

Three PRs, not one.

## M2. Downtown, in detail — the vector-tile proving ground

*"since were changing to vectors i want downtown to be more detailed now ...
before we transform main campus lets try it with all downtown."*

**This is the pilot for tiled detail and it is deliberately ambitious.** Downtown
is outside the modelled campus, so it is currently the low-detail outer ring —
flat masses with a curtain-wall pattern. Simeon wants it to be the *demonstration*
that tiles let detail grow without cost.

1. **Finish the outer-ring port first** (it was PR #43, held back correctly). The
   blocker: the 114 downtown towers get `wp` stamped in the browser by
   `quantiseOuterFacades`, clustering against a campus palette that does not exist
   until the snapshot loads. Port it into the Python bake so `wp` is on the
   feature before `tile.sh` runs. **Prove parity on all 7,625 features with the
   JS pass still in place, in its own PR**, then re-tile, switch the source and
   delete the JS. If parity cannot be reached, report the counts and stop there —
   **do not merge a version where towers lose their curtain wall.**
2. **Then add real downtown detail**: distinct tower crowns, setbacks, podium
   bases that differ from the shafts, real heights where Overture has them,
   ground-floor retail on the main streets. The Frost Bank tower, the
   Independent, the Austonian and the Capitol view corridor are the recognisable
   ones — get those right first and the rest reads as a skyline.
3. **Measure payload and load time at each step and put both in the PR.** The
   entire claim being tested is that detail is now free. If it is not free, that
   is the most important finding of the night and it changes the plan.

## M3. Fix the fifteen dead verification scripts

They throw before doing any work — `page is not defined`, `r is not defined`.
`night-silhouette.mjs` is one of them, **which is why nothing caught the Drag
rendering white at night for weeks.** This is not housekeeping.

- **First:** `cd scripts/verify && npm ci`. `node_modules` was empty on the Acer
  and made all 187 scripts look broken; re-triage after, the list may be shorter.
- Find the **shared** cause — almost certainly one hoisted page-setup block.
  Fixing fifteen files individually is the failure mode.
- **Add the wrapper lint while you are in there:** for every `js/*.js`, count
  `const wrapped = function` against `window.applyTimeOfDay = wrapped` and fail on
  a mismatch. That five-second check would have caught the Drag bug.

## M4. Distant Horizons — far things cheaper, near things sharp

*"id love it if far away things can be scaled down thats kinda what i had in mind
with the distant horizons mod."*

Tiles already carry simplified geometry at low zoom — that is what tiling is.
`scripts/tile.sh` pins `--simplification=1` (the minimum) to protect distant
buildings from being rounded off, which is the opposite of what he wants.

Turn it up deliberately: try 4, then 8, then 12; rebuild via the **Build PMTiles**
workflow; shoot `tour.mjs` at each. Also try `--drop-densest-as-needed` for trees
and props — a live oak at z13 is four pixels and there is no reason to send all
25,341 of them.

**This is a taste call. Put the before/after shots in the PR and let Simeon pick
the level** (CLAUDE.md rule 9). Do not merge a level on your own judgement.

**Also in `js/lod.js`, and this one is a bug, not taste:** *"when i go up on low
detail mode the roofs of houses become windows this is pretty bad."* A wall
pattern is landing on a roof face when LOD drops or swaps a layer — most likely
`buildings-roof` being hidden so the wall's `wp` shows on the top face.

**The Acer diagnosed this on 2026-08-02 and that guess was right. You do not
need to hunt for it: the cause is four entries in `lod.js` and the only open
question is which layers belong in a tier.**

`TIERS.mid` lists `buildings-roof`, `parts-roof` and `outer-tower-roof` next to
the genuine detail layers. Those three are not detail — they are the CAP that
covers the top face of every building extrusion. The walls are drawn with
`fill-extrusion-pattern` carrying the window tone `wp`, and MapLibre applies a
fill-extrusion pattern to the TOP face as well as the sides. So the moment the
mid tier fires, every building's roof becomes the window grid off its own walls.
That is the whole bug, and it fires exactly when he said it does: climbing, on a
preset with a low render distance.

Three ways to fix it, in the order I would try them:

1. **Take the three cap layers out of `mid`.** Simplest, obviously correct,
   costs one fill-extrusion pass at altitude. `lod-perf.mjs` already A/Bs tiers,
   so measure what that pass actually costs before assuming it matters. The
   other seven layers in `mid` (`trees-canopy`, `roofscape-*`, `roofs-pitched`,
   `moody-roof`, `arts-cap`) are real detail and should stay.
2. If that pass is expensive, keep hiding the caps but switch the wall layer
   from `fill-extrusion-pattern` to a flat `fill-extrusion-color` at the same
   time, so the top face reads as plain roof rather than as windows.
3. Give the cap layers a third tier that drops later than `mid`.

**Whatever you pick, prove it with a picture from altitude on the `performance`
preset**, not with a frame-time number — the number gets BETTER when a layer
goes missing, which is how this shipped in the first place.

**Fix this before the taste call above** — it is visible and it is wrong.

And: Simeon says the graphics menu is confusing and he does not think LOD works
at all. **Check whether it actually does anything** — set a preset, fly up,
confirm layers really disappear. If it is wired to nothing, say so plainly.

## M5. Verify suite on GitHub Actions

Blocked on M3. Do not wire broken scripts into CI.

**Each shard on its own runner.** Concurrency on one machine is only 1.5× — the
suite renders on the CPU, so runs queue for the same cores — and it *manufactures
false failures*: `retint.mjs` asserts a 2500 ms deadline, passes alone, fails
three-at-a-time with nothing broken. `scripts/verify/run.mjs` carries a
`SERIAL_ONLY` list for this; reuse it.

`workflow_dispatch` so it is a button in the GitHub mobile UI. `ubuntu-latest`,
**GitHub-hosted only** — public repo. `CHROME_PATH=/usr/bin/google-chrome`, serve
on 8123, upload `scripts/verify/shots/`, pass/fail table in the job summary so it
reads on a phone.

## M6. Kill the sleeps

**880 seconds of hardcoded `waitForTimeout` across 87 scripts**, counted from
source with loops not multiplied — ~15 minutes of every full run spent
deliberately doing nothing. Worst: `drift-check` 48 s, `lookup-check` 36 s,
`srcprobe` 26 s, `arts-shots` 22 s, `light-probe` 19 s, `orbit-check` 19 s,
`movement` 19 s.

**Per-script judgement, not a sweep.** A wait that could be a
wait-for-actually-ready is free to delete; one masking a race becomes an
intermittent failure, which is far more expensive than a slow suite. Do the big
ones, **run each three times after changing it**, put before/after in the PR.

## M7. Name the remaining 2,069 buildings

Lowest priority, safe to run last. Scrape
`utdirect.utexas.edu/apps/campus/buildings` and the Wikipedia list, match to
footprints by address or coordinate, write to `data/building_names.json` (**not**
the snapshot — a re-bake wipes it). Report a confidence per match and only write
what you would defend; a wrong name on a landmark is worse than no name. Labels
gate at `final_height >= 12`, so say how many clear that.

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.** 38
   orphaned Chromes once took the laptop to 100% CPU mid-deadline.
3. **Never leave a browser or a server running.** `node scripts/verify/reap.mjs`
   and kill your server before finishing every pass.
4. **Record every pass in `HANDOFF.md`** with the branch name.
