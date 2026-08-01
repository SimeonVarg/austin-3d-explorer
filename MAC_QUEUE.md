# MAC LANE

Rewritten 2026-08-01, late. Everything above this is superseded — the old list
was written before we knew where the time actually goes.

**One goal: make the site fast enough to show AWS.** Everything here serves that.

Take from the top, one item per PR, on `mac/*` branches. **You merge your own
work now** (CLAUDE.md rule 2 changed) — verify it, merge it, resolve your own
conflicts, delete the branch. Do not wait for Simeon.

---

## Read this first, it will save you the round it cost the Acer

**`python -m http.server` CANNOT TEST THIS SITE ANY MORE.** It ignores `Range:`
requests, and PMTiles is read by asking for a few hundred bytes out of a
multi-megabyte archive. That server returns the whole file, the library gives up,
and **every feature in the layer silently disappears** — no console error. The
Acer photographed a treeless campus and briefly believed vector tiles were
broken.

```bash
python scripts/serve.py 8123
```

That serves ranges *and* GitHub Pages' own `Cache-Control: max-age=600`, so a
payload measurement means something.

**Verify with `scripts/verify/payload.mjs`** (bytes) and
**`scripts/verify/tour.mjs`** (pictures). Read `payload.mjs`'s header before
quoting any number from it — it records two ways the same measurement was wrong.

---

## Where the payload stands

| | |
|---|---|
| was | 28.41 MB |
| now, trees tiled | **19.69 MB** |
| after M1 below | **~9 MB** |

`scripts/tile.sh` already builds **all five** archives and CI has committed them
to `data/tiles/`. Nothing to build — just wire them up.

| archive | replaces | GeoJSON | archive |
|---|---|---|---|
| `trees.pmtiles` | `trees.geojson` | 9.13 MB | 2.56 MB — **done, merged** |
| `roads.pmtiles` | `roads.geojson` | 3.70 MB | 1.93 MB |
| `outer.pmtiles` | `outer_ring.geojson` | 2.59 MB | 1.56 MB |
| `roofdetail.pmtiles` | `roofscape.detail.geojson` | 2.27 MB | 0.92 MB |
| `props.pmtiles` | `props.geojson` | 2.19 MB | 0.43 MB |

---

## M1. Wire the remaining four layers to their tile archives ← START HERE

**This is the whole job and it is four repeats of one thing.** The Acer did trees
in `js/app.js`; copy that shape exactly.

| layer | file | source id | `--layer` name |
|---|---|---|---|
| roads | `js/ground.js` ~line 717 | `RSRC` | `roads` |
| outer ring | `js/outer.js` ~line 99 | see `DATA` | `outer` |
| roof detail | `js/roofs.js` ~line 190 | `SRC_D` | `roofdetail` |
| props | `js/props.js` ~line 181 | `SRC` | `props` |

The pattern, from `js/app.js`:

```js
const t = window.tileSource && window.tileSource('roads');
map.addSource(SRC, t ? t.source : { type:'geojson', data:'data/roads.geojson' });
const lp = t ? t.layerProps : {};
// ...then spread ...lp into EVERY layer that uses that source
map.addLayer({ id:'…', source:SRC, ...lp, /* rest unchanged */ });
```

**Four things that will bite you, in the order they will:**

1. **`source-layer` is not optional.** A vector source without it draws
   absolutely nothing and reports no error. Spread `layerProps` into *every*
   layer on that source, not just the first. This is the single most likely way
   to "lose" a layer.
2. **`setData` and `updateData` do not exist on a vector source.** If any code
   appends to that source at runtime, it will fail silently. `js/capitol.js`
   solves this for trees and ground by adding a sibling GeoJSON source and
   **cloning** the layers off `getStyle()` — reuse `cloneLayersOnto`, do not
   hand-write a second layer, or the two definitions drift.
3. **Property types.** Tippecanoe preserves properties but a filter comparing a
   string to a number will now behave differently. Check any `filter:` on the
   layer against a real feature via `querySourceFeatures(id, {sourceLayer})`.
4. **One PR per layer.** Four small merges beat one big one, and if a layer
   vanishes you know which change did it.

**Prove each one with a picture, not a byte count.** `node scripts/verify/tour.mjs
day` and look at the shots — a layer can be 100% absent and the payload will look
*better*.

---

## M2. Distant Horizons: make far-away things cheap and near things sharp

**Simeon asked for this by name and it is now half-built by accident.** Vector
tiles already carry lower-detail versions at lower zoom levels — that is what
tiling *is*. What is missing is using it deliberately.

Right now `scripts/tile.sh` sets `--simplification=1` (tippecanoe's minimum)
because the Acer was protecting against distant buildings getting rounded off.
**Simeon wants the opposite:** *"your one real downside is a win for me id love it
if far away things can be scaled down thats kinda what i had in mind with the
distant horizons mod."*

So: turn it up, deliberately, and find where it starts to show.

- Raise `--simplification` in `scripts/tile.sh` (try 4, then 8, then 12),
  rebuild via the **Build PMTiles** workflow, and shoot `tour.mjs` at each.
- Compare the `aerial-wide` and `downtown-skyline` poses. The question is not
  "is it different" — it will be. It is **"can you see it from the camera
  distance where that geometry actually appears?"**
- Also try `--drop-densest-as-needed` and per-zoom feature dropping for trees and
  props specifically. A live oak at z13 is four pixels; there is no reason to
  send all 25,341 of them.
- Report the payload at each setting alongside the picture. **This is a taste
  call — escalate it. Put the before/after shots in the PR and let Simeon pick
  the level.** (CLAUDE.md rule 9: taste is his, execution is yours.)

There is also a real LOD system in `js/lod.js` that drops whole layers at
altitude. Simeon says the graphics menu is confusing and he does not think it
works. **Check whether it actually does anything** — set the preset, fly up,
and confirm layers really disappear. If it is wired to nothing, say so.

---

## M3. Kill the sleeps

**880 seconds of hardcoded `waitForTimeout` across 87 scripts**, counted from
source, loops not multiplied. ~15 minutes of every full run is the harness
deliberately doing nothing.

Worst: `drift-check` 48 s, `lookup-check` 36 s, `srcprobe` 26 s, `arts-shots`
22 s, `light-probe` 19 s, `orbit-check` 19 s, `movement` 19 s.

**Per-script judgement, not a sweep.** A `waitForTimeout(6000)` that could be a
wait-for-actually-ready is free to delete; one that is masking a race becomes an
intermittent failure, which is far more expensive than a slow suite. Do the big
ones, **run each three times after changing it** to prove it did not get flaky,
and put before/after times in the PR.

---

## M4. Fix the "page is not defined" regression

Fifteen scripts crash instantly. **Check `scripts/verify/node_modules` is not
empty first** (`cd scripts/verify && npm ci`) — it was empty on the Acer and made
all 187 scripts look broken. Then find the *shared* cause; fixing fifteen files
individually is the failure mode.

---

## M5. Verify suite on GitHub Actions

Blocked on M4. **Each shard on its own runner** — concurrency on one machine is
only 1.5× (the suite renders on the CPU, so runs queue for the same cores) and it
manufactures false failures. `scripts/verify/run.mjs` has a `SERIAL_ONLY` list
for scripts with millisecond budgets; reuse it.

---

## M6. Name the remaining 2,069 buildings

Lower priority than everything above — it is polish, not speed. Scrape
`utdirect.utexas.edu/apps/campus/buildings`, match to footprints by address or
coordinate, write to `data/building_names.json` (**not** the snapshot, a re-bake
wipes it). Report a confidence per match; a wrong name on a landmark is worse
than no name.

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo — a stranger's PR
   would run code on the machine.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.** 38
   orphaned Chromes once took the laptop to 100% CPU mid-deadline.
3. **Never leave a browser or a server running.** `node scripts/verify/reap.mjs`
   before you finish.
