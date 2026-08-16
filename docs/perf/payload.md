# payload.md — what a first-time visitor downloads and parses

**Measured 2026-08-16, Acer lane, from files on disk plus the loader code. No
browser was opened for any figure in this file** (that was the phase's
instruction), which is exactly why the caveats below are as long as the tables.
Read the caveats before quoting a number.

Sizes are byte-exact off disk. Gzip is Python `gzip` level 6, which is what a
CDN's default gzip produces to within a percent or two.

---

## 0. THE INSTRUMENTS, AND WHAT THEY GET WRONG

Every number in this file carries the setting that produced it, because in this
repo more measurements have been retracted for a bad setting than for bad
arithmetic.

- **`scripts/serve.py` DOES NOT GZIP.** GitHub Pages does. Every text figure in
  this file is therefore *not* what a local `content-length` will show — the
  local server sends the raw column, the real site sends the gz column, and the
  two differ by about **6x** across our GeoJSON. The repo has a documented case
  of a 5x-overstated byte figure from measuring against a non-gzipping server;
  do not repeat it by comparing a local waterfall to this table.
- **PMTiles do not gzip further.** Measured: `trees.pmtiles` compresses 1.01x,
  `roads` 1.07x, `outer`/`roofdetail`/`props` 1.00x. Each tile is already gzipped
  *inside* the archive. So for tiled layers, raw bytes on disk **are** wire
  bytes, and the honest comparison against a flat file is `archive-raw` vs
  `flat-GZIPPED` — not raw vs raw. Section 5 is built on that and the conclusion
  changes because of it.
- **Parse times are node v25 (V8), unthrottled, on a machine under real load.**
  Same engine as Chrome, different host. `scripts/verify/perf.mjs` throttles the
  CPU **4x by default**; multiply every parse figure here by ~4 to compare
  against anything that script prints. A mid-range phone is worse than either.
- **Minimum of 7 interleaved reps, never a mean, never one reading.** The whole
  set was then re-run at roughly double the machine load as a sanity check.

  | condition | chrome procs | node procs | CPU |
  |---|---:|---:|---:|
  | before run 1 | 13 | 0 | 24.2% |
  | after run 2 | 23 | 1 | 65.7% |

  Every file's minimum moved by 2–10% across that 2.7x change in load
  (`entrances` 63.85 → 70.35 ms, `ground` 57.52 → 58.29 ms, `trees` 349.9 →
  392.2 ms). The minimum-of-reps discipline held. **The tables quote run 1.**
- **What is NOT measured here, and must not be inferred from it:** third-party
  bytes. `index.html` pulls `maplibre-gl@5.24.0` (js + css) and `pmtiles@3.0.6`
  from unpkg, and `js/app.js:304` builds the map on
  `https://tiles.openfreemap.org/styles/liberty` — a style JSON plus its vector
  tiles, glyph PBFs and sprite sheet. That is a real and possibly large part of a
  visitor's first load and **none of it was measured tonight.** Any "total" below
  is a total *of our own origin*.

---

## 1. WHEN EACH FILE LOADS

Four classes, and the class is the whole point — bytes matter less than which
thread pays and whether the visitor is waiting.

### EAGER, parsed on the MAIN THREAD

The module `fetch`es the file, `JSON.parse`s it itself, then hands the parsed
object to `map.addSource({ data: <object> })`. All of it inside `buildScene()`
or a module `boot()` on `map.on('load')` — i.e. behind the loading veil.

| file | raw MB | gz KB | features | JSON.parse ms |
|---|---:|---:|---:|---:|
| `snapshots/2026-08-16/buildings.detailed.geojson` | 1.483 | 312 | 2,453 | 14.7 |
| `roofs.geojson` | 1.689 | 171 | 4,897 | 20.1 |
| `places.geojson` | 1.020 | 66 | 2,533 | 10.1 |
| `art.geojson` | 0.622 | 60 | 2,189 | 6.8 |
| `capitol_ground.geojson` | 0.588 | 117 | 1,161 | 6.0 |
| `stadium.geojson` | 0.530 | 51 | 1,448 | 5.7 |
| `westcampus.geojson` | 0.410 | 27 | 1,144 | 4.5 |
| `capitol.geojson` | 0.326 | 57 | 604 | 3.2 |
| `capitol_trees.geojson` | 0.202 | 30 | 612 | 2.3 |
| `tower.geojson` | 0.071 | 4 | 225 | 0.8 |
| `drag.geojson` | 0.061 | 6 | 124 | 0.6 |
| `arts.geojson` | 0.048 | 8 | 79 | 0.5 |
| `moody.geojson` | 0.015 | 2 | 17 | 0.2 |
| `signs.json` | 0.011 | 2 | 48 | 0.1 |
| `heroes.geojson` | 0.009 | 2 | 20 | 0.1 |
| `snapshots/2026-08-16/parts.detailed.geojson` | 0.007 | 1 | 16 | 0.1 |
| `capitol_parts.geojson` | 0.006 | 1 | 13 | 0.1 |
| `manifest.json` | 0.003 | 1 | — | 0.0 |
| `building_names.json` | 0.002 | 1 | — | 0.0 |
| `capitol_overrides.json` | 0.002 | 1 | — | 0.0 |
| `outer_tower_palette.json` | 0.002 | 1 | — | 0.0 |
| `facade_palette.json` | 0.001 | 0 | — | 0.0 |
| **total, 22 files** | **7.109** | **920** | 17,583 | **75.9** |

### EAGER, parsed in the WORKER

`map.addSource({ data: '<url>' })`. MapLibre fetches and parses off the main
thread. These cost wire bytes and worker time; they cost the main thread nothing
but the tiling result coming back.

| file | raw MB | gz KB | features | parse ms (worker) |
|---|---:|---:|---:|---:|
| `ground.geojson` | 5.193 | 967 | 10,937 | 57.5 |
| `roofscape.geojson` | 1.408 | 240 | 3,649 | 18.0 |
| `capitol_dome.geojson` | 0.048 | 7 | 75 | ~0.5 |
| `depth.geojson` | 0.032 | 4 | 63 | 0.3 |
| **total, 4 files** | **6.680** | **1,219** | 14,724 | **~76** |

### EAGER, TILED (PMTiles, range requests — only what the camera sees)

| archive | raw MB | z13 | z14 | z15 | z16 | tiles |
|---|---:|---:|---:|---:|---:|---:|
| `tiles/trees.pmtiles` | 5.820 | 0.833 | 0.964 | 1.179 | 2.841 | 279 |
| `tiles/roads.pmtiles` | 2.019 | 0.326 | 0.393 | 0.516 | 0.778 | 2,184 |
| `tiles/outer.pmtiles` | 1.982 | 0.366 | 0.427 | 0.515 | 0.670 | 375 |
| `tiles/roofdetail.pmtiles` | 0.963 | 0.151 | 0.221 | 0.270 | 0.318 | 49 |
| `tiles/props.pmtiles` | 0.157 | 0.004 | 0.008 | 0.016 | 0.125 | 46 |
| **total** | **10.941** | 1.680 | 2.013 | 2.496 | 4.732 | 2,933 |

(MB per zoom level. All five archives are z13–16, `maxzoom: 16` in `js/tiles.js`,
matching `--maximum-zoom` in `scripts/tile.sh`.)

**Main-thread parse cost of these five: zero.** MVT is decoded in the worker.
That is the largest single thing tiling bought and it is invisible in a byte
count.

### DEFERRED — `entrances.geojson`

**The lazy load did happen. Verified in code, not taken on trust.**
`js/entrances.js` `ENT.defer` defaults `on: true`; `initEntrances` is called by
whichever fires first of: the map's first `idle` + 2,000 ms, the camera dropping
below 60 m, or a 25,000 ms ceiling. `?entdefer=0` restores the old eager load.

| file | raw MB | gz KB | features | JSON.parse ms |
|---|---:|---:|---:|---:|
| `entrances.geojson` | 6.690 | 405 | **14,242** | 63.9 |

Two corrections to the brief I was given: the file is **6.690 MB, not 5.44 MB**
(it grew with the 2026-08-15/16 bakes; `js/entrances.js`'s own header comment
still says 6.38 MB / 396 KB and is now stale), and it carries **14,242
features, not 11,890**.

**Deferred is not the same as conditional.** Every visitor still pays all 405 KB
and all 63.9 ms, on the main thread, about two seconds after the veil lifts —
i.e. during the intro flight. See item 1 of section 6.

### LAZY — only when the user actually searches

`js/wayfind.js` `loadGraph()` is called from the search box and nowhere else.
A visitor who never types a destination never fetches these.

| file | raw MB | gz KB | JSON.parse ms |
|---|---:|---:|---:|
| `walk_graph.json` | 0.343 | 105 | 2.5 |
| `ut_buildings.json` | 0.023 | 5 | 0.2 |

This is the model the rest of the app should be judged against. It is correct
already; nothing to do.

### NEVER fetched (superseded by the PMTiles archives)

These are the fallback when `data/tiles/` is absent or `?tiles=0` is set. On the
live site they are **never downloaded**. Their size is not a visitor cost.

| file | raw MB | gz KB | features |
|---|---:|---:|---:|
| `trees.geojson` | 27.647 | 4,096 | 67,443 |
| `roads.geojson` | 3.879 | 433 | 17,462 |
| `outer_ring.geojson` | 3.339 | 627 | 9,149 |
| `roofscape.detail.geojson` | 2.384 | 339 | 8,034 |
| `props.geojson` | 1.520 | 178 | 4,869 |
| **total** | **38.769** | **5,673** | 106,957 |

Also never fetched: the eleven older `data/snapshots/*` directories (only
`manifest.latest` loads — `js/app.js:298`), every `*.png` aerial and debug
raster in `data/` (~62 MB), `data/osm_cache/` (27 MB),
`data/imagery_cache/` (55 MB), `data/outer/outer_raw.geojson` (23 MB),
`roof_survey.json`, `roof_runs.json`, `canopy_detected.json`,
`hero_designs.json`, `building_tags.geojson`, `landscape.geojson`,
`parts.geojson`, `capitol_parts`-adjacent bake intermediates. `data/` is 295 MB
on disk and a visitor touches under 5% of it.

---

## 2. THE TOTAL A FIRST-TIME VISITOR PAYS

Our origin only. Third-party (maplibre, pmtiles, openfreemap basemap) is
**unmeasured** — see section 0.

| | gzipped | raw |
|---|---:|---:|
| our JS + CSS + HTML (29 files) | **494 KB** | 1.409 MB |
| eager JSON/GeoJSON, main-thread parsed | **920 KB** | 7.109 MB |
| eager JSON/GeoJSON, worker parsed | **1,219 KB** | 6.680 MB |
| PMTiles range requests for the opening view | **0.87 – 10.94 MB** (see below) | same |
| **first-paint subtotal, excluding tiles** | **2.63 MB** | 15.20 MB |
| deferred `entrances.geojson` (~2 s after idle) | **405 KB** | 6.690 MB |
| lazy `walk_graph` + register (only if they search) | 110 KB | 0.366 MB |

**The PMTiles figure is a range and I am not going to pretend it is a number.**
The exact tile set a pitch-74, z16.5 spawn frame requests depends on MapLibre's
frustum-covering algorithm, and determining it requires a browser, which this
phase forbade. What I can bound from the archives themselves:

- **Floor — 0.87 MB.** The 3x3 block of z16 tiles centred on the spawn tile
  (z16 x=14974 y=26978), summed across all five archives. That is the near field
  only.
- **Ceiling — 10.94 MB.** Every tile in every archive. A long flyover
  approaches this; one frame does not.
- A pitch-74 frame sees several kilometres, so the opening view pulls coarse
  z13/z14 tiles for the far half as well as z16 for the near half. My best guess
  is 2–4 MB, and it is a **guess**, flagged as one, not a measurement.

**Honest total, then:** roughly **3.5 – 5 MB gzipped from our origin for the
opening frames**, plus 0.4 MB of doors shortly after, plus an unmeasured
third-party bill.

---

## 3. THE TOTAL THE MAIN THREAD MUST PARSE

The number nobody had.

| | ms (unthrottled) | ms at perf.mjs's 4x throttle |
|---|---:|---:|
| eager `JSON.parse`, 22 files, main thread | **75.9** | ~304 |
| deferred `entrances.geojson` parse | 63.9 | ~256 |
| worker `JSON.parse`, 4 files (not main thread) | ~76 | ~304 |

And a cost that is probably real but that I could **not verify tonight**:

Fifteen modules hand MapLibre a *parsed object* rather than a URL. If MapLibre
serialises that object with `JSON.stringify` to post it to the tile worker — which
is my understanding of `GeoJSONSource._updateWorkerData`, but **the library is
loaded from unpkg and is not on disk in this repo, so I did not read it** — then
each of those files is also stringified on the main thread:

| file | JSON.stringify ms |
|---|---:|
| `entrances.geojson` | 36.7 |
| `roofs.geojson` | 34.6 |
| `buildings.detailed.geojson` | 11.5 |
| `places.geojson` | 7.4 |
| `art.geojson` | 3.7 |
| `stadium.geojson` | 3.3 |
| `westcampus.geojson` | 2.7 |
| others (drag, arts, moody, heroes, tower) | 1.1 |
| **total** | **100.9** |

**One line in a browser settles it** and should be the first thing the next
phase runs: patch `JSON.stringify` with a timing wrapper before
`maplibregl.Map` is constructed and log every call over 1 ms. If it fires,
the eager main-thread bill is not 76 ms but ~140 ms, and `roofs.geojson`
alone is 55 ms of it.

### What this does NOT explain

Simeon's standing complaint is *"downtown buildings arent loaded even when
loading screen completes"*. **Parse is not the cause and I am not going to sell
it as one.** 76 ms — or even 300 ms throttled — cannot produce seconds of empty
land. The real mechanism was already diagnosed and fixed in `js/app.js`
`INTRO.needs` / `introGate()`: `map.isSourceLoaded()` answers *for the current
viewport*, the veil used to lift on a spawn-view (campus) check, and the intro
then jumped 2 km south to downtown where nothing had been tiled. The gate now
waits on `austin-outer`, `austin-buildings`, `austin-ground`, `austin-roads` at
the intro's own start pose. Parse cost is worth cutting on its own merits; it is
not that bug.

---

## 4. RANKED: WHAT TO DO

Ordered by (main-thread ms + gz bytes) saved per unit of risk. Savings are
estimates from the measurements above and are labelled as such.

### 1. Bake `data/tiles/entrances.pmtiles` — the biggest single win, and the code is already written

`js/entrances.js:1015` already asks `window.tileSource('entrances')` and uses a
vector source if the archive exists. **It does not exist.** Adding it to
`scripts/tile.sh` (same pattern as the other five, `--layer=entrances`) is a
bake change, not an app change.

*Expected:* **−405 KB gz** off every visit, **−63.9 ms** of main-thread parse
(**−256 ms** throttled), **−36.7 ms** of stringify if section 3's caveat holds,
and 14,242 features stop being tiled from scratch in the worker on every load.
Net: the largest deferred hitch in the app disappears rather than moving.
*Risk:* low — the fallback path is the current behaviour, unchanged.

### 2. Split the `caps` table out of `roofs.geojson`

`roofs.geojson` is fetched by `js/app.js:167` **only** because it carries `caps`,
which must be stamped onto building features before `austin-buildings` is added.
The other 1.69 MB is then handed to `addRoofLayers` as an object
(`js/app.js:672`). Emit `data/roof_caps.json` (id → colour; a few tens of KB at
most) from `bake_roofs.py`, and let `austin-roofs` load from the URL in the
worker.

*Expected:* **−20.1 ms** parse and **−34.6 ms** stringify off the main thread
(**~−220 ms** throttled) for zero change in bytes or pixels. The single largest
main-thread item on the eager path.
*Risk:* low, but it touches `scripts/bake_roofs.py` — check `MAC_QUEUE.md` for
ownership before starting.

### 3. Hand MapLibre a URL wherever the module does not need the parsed body

The pattern `fetch → JSON.parse → addSource({data: object})` appears in fifteen
modules. Some genuinely need the body: `capitol` (merges into the scene before
quantisation), `stadium` (`replacedBuildingIds`), `art` (the `authored` list),
`drag` (`stampPatterns` mutates features). Some appear not to — `places.js`
(lines 339→349) does nothing to `gj` between the fetch and the `addSource`.

*Expected:* `places` alone is **−10.1 ms** parse **−7.4 ms** stringify for
1.02 MB. Across the plausible candidates, ~20–25 ms.
*Risk:* medium — each one needs a check for later uses of `gj` in the module,
and getting it wrong means a layer silently renders unstyled. Do them one at a
time, not as a sweep.

### 4. Tile `ground.geojson`

At **967 KB gzipped it is the largest single thing a visitor downloads from us**
— 45% of the eager GeoJSON bill. It is already worker-parsed, so this is a
bytes-and-time-to-first-paint fix, not a main-thread one.

*Expected:* by analogy with the five existing archives, a single view would pull
roughly a third of it. Order **−300 to −600 KB** on the opening load. Read
section 5 first: the win is smaller than the flat-file size suggests.
*Risk:* medium. `js/ground.js` is heavily zoom- and rank-dependent (the ground
rank ladder from PR #78), and `maxzoom: 16` on a tiled source changes how
patterns anchor. This is a real pass, not an afternoon.

### 5. Fix the stale comment in `js/entrances.js`

Its header says 6.38 MB / 396 KB. It is 6.690 MB / 405 KB with 14,242 features.
Costs nothing, prevents the next lane quoting a stale figure. (Not done here —
this phase may only write this file.)

### THINGS THAT ARE ALREADY FINE — do not "optimise" these

- **The 38.8 MB of flat GeoJSON superseded by PMTiles.** Never fetched on the
  live site. Deleting it would remove the `?tiles=0` A/B lever and the
  no-archives fallback that `js/tiles.js` was deliberately built around, and
  would save a visitor **zero bytes**. Leave it.
- **The eleven stale snapshot directories, `osm_cache/`, `imagery_cache/`, the
  aerial PNGs.** ~220 MB of repo, 0 bytes of visitor. A clone-time annoyance and
  nothing else. Not a performance item.
- **`walk_graph.json`.** 105 KB gz, 2.5 ms, fetched only on a real search. This
  is the pattern to copy, not fix.
- **`depth.geojson`, `capitol_dome.geojson`, `heroes`, `moody`, `signs`,
  `building_names`, both palettes.** Sub-millisecond, sub-10 KB. Touching them
  is pure churn.
- **Worker count.** `js/tiles.js` already scales tile workers to `cores/2`
  capped at 4, with five interleaved reps behind the choice. Settled.

---

## 5. THE TILING WIN IS REAL BUT SMALLER THAN IT LOOKS, AND HERE IS WHY

`js/tiles.js`'s header says the five big layers were "20 MB of the 28". That is a
**raw-bytes** comparison and it flatters tiling, because the flat files gzip
6–9x on the wire and the archives do not gzip at all (measured: 1.00–1.07x).

The honest comparison:

| | on the wire |
|---|---:|
| the five flat files, **gzipped**, whole city | **5.67 MB** |
| the five archives, whole city (no further compression possible) | **10.94 MB** |
| the five archives, near-field 3x3 at z16 only | **0.87 MB** |

So on **total** bytes for a full tour of the city, tiling is roughly **2x worse**.
What it actually buys, and these are the reasons it was right:

1. **You do not need the whole city to see the first frame.** 0.87 MB instead of
   5.67 MB before anything appears. That is the load-time win and it is large.
2. **Zero main-thread parse.** 350 ms of `trees.geojson` parse, 47 ms of roads,
   40 ms of outer ring — all gone, replaced by worker MVT decode.
3. **Detail stops costing load time.** The point in the header, and it is right.

**The correction to the rule of thumb:** tiling is a *time-to-first-paint and
main-thread* optimisation, not a bytes optimisation. Anyone proposing to tile
something should be asked which of the three wins above they are buying. For
`ground.geojson` (item 4) the answer is 1 and 3, and that is enough — but the
saved-bytes number in the PR should be honest.

---

## 6. WHAT I DID NOT ESTABLISH

Written down so the next lane does not assume it was covered.

1. **The exact PMTiles bytes for the spawn view.** Needs a browser and a CDP
   network trace. Section 2 gives a floor, a ceiling, and a labelled guess.
2. **Whether MapLibre stringifies parsed-object sources on the main thread.**
   The library is not on disk. Section 3's 100.9 ms is conditional on it. One
   browser line settles it.
3. **Third-party bytes** — unpkg maplibre + pmtiles, and the whole
   openfreemap `liberty` basemap (style JSON, vector tiles, glyphs, sprite).
   Entirely unmeasured. Could plausibly rival our own payload.
4. **`quantiseFacades` and the other post-parse main-thread passes.** They
   iterate every building feature at boot and are almost certainly comparable to
   the parse cost. Not measurable outside the app.
5. **geojson-vt tiling time in the worker**, which is normally several times the
   `JSON.parse` cost it follows. `ground.geojson`'s 10,937 features are the
   suspect there.
6. **Anything about frame rate.** This file is load only. K1's frame-cost half,
   and Y7 (37.9 ms outer-ring scan) and Y15 (841.5 ms trunk-field incremental
   scan) are untouched by anything here.
7. **Real-network behaviour.** Everything above is bytes on disk. No 4g/3g
   throttling, no latency, no HTTP/2 multiplexing effects.
