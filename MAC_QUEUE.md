# MAC LANE

Rewritten 2026-08-01, late evening, for an unattended overnight run. Everything
above this line in git history is superseded.

**Goal: the site is fast and clean enough to show AWS.** Work top to bottom.
Take the next unblocked item, one PR each, on `mac/*` branches.

**You merge your own work** (CLAUDE.md rule 2) — verify it, merge it, resolve
your own conflicts, delete the branch. Do not wait for Simeon. **Merging red is
the one thing that rule does not permit.** If an item cannot be made to pass,
close the PR or leave it open with the reason written down, and move to the next
item rather than stopping.

---

## Read this first — three traps that have each cost hours

1. **`python -m http.server` cannot test this site.** It ignores `Range:`
   requests, which PMTiles needs, and every feature in a tiled layer then
   silently vanishes with **no console error**. A treeless campus was
   photographed and briefly believed. Use `python scripts/serve.py 8123`.
2. **A missing layer makes the numbers look BETTER.** Payload drops, frame time
   drops, everything reads as a win. **Verify with a picture** — `node
   scripts/verify/tour.mjs day` — before believing any measurement.
3. **A flag that reports success is not success.** Item 9 in `QUEUE.md`: the Drag
   rendered white at night for weeks while `window.__dragTodHooked` said `true`,
   because the flag was set two lines under the assignment that was missing.
   Assert the effect, never the intention.

And the standing rule: **minimum of interleaved reps, never one reading.** Load
time here has been measured from 11 s to 65 s for an identical page on a quiet
machine.

---

## Where things stand

| | start of tonight | now |
|---|---|---|
| visitor download | 28.41 MB | **12.08 MB** |
| time to city on screen | 7.1 s | **5.6 s** |

Tiled and merged: trees, roads, roof detail, props. Plus MapLibre was running
**one** tile worker on a 16-core machine — now scaled, ~0.85 s.

---

## M1. The outer ring — finish your own PR #43

**You held this back correctly** and flagged it as a taste call. Simeon has not
answered, and it should not sit blocking the lane all night. So:

**Do the bake-side half now, which needs no taste call.** The blocker is that the
114 downtown towers get `wp` stamped onto their features **in the browser** by
`quantiseOuterFacades`, which clusters against a campus palette that does not
exist until the snapshot loads. Tiles cannot carry a property the browser has not
computed yet.

Move that computation into Python, at bake time, so `wp` is already on the
feature before `tile.sh` runs:

1. Port `quantiseOuterFacades` into the bake (a new `scripts/bake_outer_wp.py`,
   or extend the existing outer-ring bake).
2. **Prove parity before deleting anything.** Run both, compare `wp` per feature,
   and require an exact match on all 7,625 features. Do that in its own PR with
   the JS pass still in place.
3. Only then re-tile, switch the source, and delete the JS pass.

If parity cannot be reached, say so in the PR with the counts and move on. **Do
not merge a version where some towers lose their curtain wall** — that is a
visible regression and it is what you were right to hold back.

---

## M2. The stadium is 16% of the wrongly-bright night pixels

`QUEUE.md` item 10, and it is now the biggest known visual defect.

`scripts/verify/night-pale.mjs` hides one pass at a time and counts pale pixels
below the horizon. After the Drag was fixed, `stadium-*` is the largest thing
left. `data/stadium.geojson` has **499 of 511 features with no night colour**.

**Start from what is already checked, do not redo it.** Every pass that builds a
time-of-day wrapper installs it (arts, drag, moody, outer, places, tower,
westcampus all `builds=1 installs=1`). **`js/stadium.js` never builds one at
all** — so it retints by some other route, or not at all. That is the thread.

DKR is *deliberately* floodlit and reads correctly in
`shots/tour/night-dkr-stadium.png`, so some of that 16% is meant to be there.
Establish which part is wrong before changing anything.

---

## M3. Fix the dead verification scripts

Fifteen scripts throw before doing any work — `page is not defined`,
`r is not defined`. `night-silhouette.mjs` is one of them, which is **why nothing
caught the Drag bug**.

- **First:** `cd scripts/verify && npm ci`. `node_modules` was empty on the Acer
  and made all 187 scripts look broken; re-triage after that, the list may be
  shorter than fifteen.
- Then find the **shared** cause. Fixing fifteen files individually is the
  failure mode here — it is almost certainly one hoisted page-setup block.
- Add the wrapper lint from `QUEUE.md` item 10 while you are in there: a pass
  that builds a time-of-day wrapper and does not install it should fail a check.

---

## M4. Verify suite on GitHub Actions

Blocked on M3. Do not wire broken scripts into CI.

**Each shard on its own runner.** Concurrency on one machine is only 1.5× — the
suite renders on the CPU, so runs queue for the same cores — and it *manufactures
false failures*: `retint.mjs` asserts a 2500 ms deadline, passes alone, and fails
three-at-a-time with nothing broken. `scripts/verify/run.mjs` carries a
`SERIAL_ONLY` list for exactly this; reuse it rather than rediscovering it.

`workflow_dispatch` so it is a button in the GitHub mobile UI. `ubuntu-latest`,
**GitHub-hosted only** — this repo is public and a self-hosted runner would let a
stranger's pull request run code on the machine. `CHROME_PATH=/usr/bin/google-chrome`,
serve on 8123, upload `scripts/verify/shots/`, pass/fail table in the job summary
so it is readable on a phone.

---

## M5. Kill the sleeps

**880 seconds of hardcoded `waitForTimeout` across 87 scripts**, counted from
source with loops not multiplied. ~15 minutes of every full run is the harness
deliberately doing nothing.

Worst: `drift-check` 48 s, `lookup-check` 36 s, `srcprobe` 26 s, `arts-shots`
22 s, `light-probe` 19 s, `orbit-check` 19 s, `movement` 19 s.

**Per-script judgement, not a sweep.** A `waitForTimeout(6000)` that could be a
wait-for-actually-ready is free to delete; one masking a race becomes an
intermittent failure, which is far more expensive than a slow suite. Do the big
ones, **run each three times after changing it** to prove it did not get flaky,
and put before/after times in the PR.

---

## M6. Distant Horizons — far things cheaper, near things sharp

Simeon asked for this by name: *"id love it if far away things can be scaled down
thats kinda what i had in mind with the distant horizons mod."*

Tiles already carry simplified geometry at low zoom — that is what tiling is.
`scripts/tile.sh` currently pins `--simplification=1` (the minimum) to protect
distant buildings from being rounded off, which is the opposite of what he wants.

Turn it up deliberately and find where it starts to show: try 4, then 8, then 12;
rebuild via the **Build PMTiles** workflow; shoot `tour.mjs` at each. Also try
`--drop-densest-as-needed` for trees and props — a live oak at z13 is four pixels
and there is no reason to send all 25,341.

**This is a taste call. Put the before/after shots in the PR and let Simeon pick
the level** (CLAUDE.md rule 9). Do not merge a level on your own judgement.

Also: `js/lod.js` drops whole layers at altitude, and Simeon says the graphics
menu is confusing and he does not think it works. **Check whether it actually
does anything** — set a preset, fly up, confirm layers really disappear. If it is
wired to nothing, say so plainly.

---

## M7. Name the remaining 2,069 buildings

Lowest priority — polish, not speed, and safe to run last.

Scrape `utdirect.utexas.edu/apps/campus/buildings` and the Wikipedia list. Match
to footprints by address or coordinate. Write to `data/building_names.json`
(**not** the snapshot — a re-bake wipes it). Report a confidence per match and
only write the ones you would defend: a wrong name on a landmark is worse than no
name. Labels are gated at `final_height >= 12`, so say how many of your matches
clear that.

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.** 38
   orphaned Chromes once took the laptop to 100% CPU mid-deadline.
3. **Never leave a browser or a server running.** `node scripts/verify/reap.mjs`
   before you finish every pass, and kill your server.
4. **Record each pass in `HANDOFF.md`** with the branch name.
