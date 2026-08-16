# NB6: the app refused its own baked palette, and that refusal was load-bearing

Written 2026-08-16 by the Acer lane, branch `acer/o3-palette`.

NB6 was filed as a boot-cost regression: `data/facade_palette.json` recorded
`2026-08-03`, `manifest.latest` said `2026-08-16`, so `js/facades.js` fell back
to electing the fourteen-bucket palette in the browser at every load. The queue
entry said the fix was one line — re-run `scripts/bake_facades.py` — and that
the palette and buckets come back byte-identical, "**Boot cost, not pixels**".

**The boot cost is real and small. The "not pixels" half was wrong.** Re-baking
the date alone and shipping it would have turned the floodlight off the Texas
Capitol at night. The refusal that NB6 exists to remove is the only reason the
Capitol has looked lit.

---

## 1. The guard, exactly

`js/facades.js:815-822`:

```js
const want = m && m.latest;                      // data/manifest.json .latest
if (want && b.snapshot !== want) {               // b = data/facade_palette.json
  bakedSource = `baked for ${b.snapshot}, scene is ${want}`;
  return null;                                   // -> the browser elects
}
```

It compares **two date strings**, not two palettes: the `snapshot` key the bake
stamped into its own output against `manifest.latest`, the date `js/app.js`
resolves the scene from. `"2026-08-03" !== "2026-08-16"`, so the baked palette is
dropped on the floor and `quantiseFacades` re-elects.

That is a defensible design and the file says why at `js/facades.js:781-786`: a
palette that is half baked and half elected is fourteen buckets that do not mean
the same thing twice, so adoption is all-or-nothing and keyed on provenance. It
went out of sync because the data bot rolled the snapshot to `2026-08-15` and
nothing re-ran the bake. `scripts/bake_facades.py`'s own health note says so, in
capitals, and `scripts/snapshot_parity.py` has been reporting it as
STALE-BUT-EQUAL on every run since it was written last night.

There is a **second** guard at `:835-845`: every group key present in the scene
must exist in the baked index, or the whole palette is refused. It was not the
one firing.

---

## 2. What the refusal costs — measured

Headed (`launch(chromium, { headless: false })`, so hardware GL and no
background throttling), one browser session, arms **alternated** A B A B A B,
seven timed reps of the real `window.quantiseFacades` per page load on that
page's own freshly-assembled 3,057-feature copy, **minimum** of reps within a
load and minimum across loads. Arm A is `?bakedfacades=0` (elect), arm B is the
bake armed; each load asserts `facadePaletteSource()` before its numbers count.

```
load 1 elect  min 15.50 ms    load 1 baked  min 10.60 ms
load 2 elect  min 14.70 ms    load 2 baked  min  6.30 ms
load 3 elect  min  5.80 ms    load 3 baked  min  4.00 ms
load 4 elect  min  5.20 ms    load 4 baked  min 11.20 ms
load 5 elect  min  5.40 ms    load 5 baked  min  4.00 ms

elect  MIN across loads 5.20 ms
baked  MIN across loads 4.00 ms
delta                   1.20 ms
```

**Machine load, quoted with the number because it is part of the answer:**
38 Chrome processes and 4 node processes at 93 % CPU when the run started, 28
and 3 at 44 % when it finished — two other lanes were working. That is why the
first two loads read 15 ms and the last three read 5 ms for the *same* code.

**The honest reading: about 1 ms, and the effect is smaller than the noise.**
Load 4's baked arm (11.20 ms) came in *above* three of the five elect readings.
Both paths walk all 3,057 features in `stampAll`; the only work the bake removes
is the grouping, the mean, the sort and the tail-fold. On a quiet machine this
would be worth re-measuring, but nothing about this file is going to move the
frame budget. The reason to fix it is that **a shipped file the app ignores is a
lie in the repository**, not that it is expensive.

Not established: the end-to-end boot number. `quantiseFacades` is called from
`js/app.js`'s `loadScene`, which this lane does not own and did not instrument,
so the figure above is the function's own cost and not "page load got 1.2 ms
faster".

---

## 3. The palette was NOT equal, and this is the finding

`snapshot_parity.py` called it STALE-BUT-EQUAL. That verdict is about the
*inputs* — `buildings.detailed.geojson` is byte-identical between `2026-08-03`
and `2026-08-16` — and it is correct about them. It says nothing about whether
the baked palette equals the one the browser elects, and it does not claim to.

Compared entry by entry, in one page session, elected against baked:

```
  [ 0] DIFF  elect=#bd8477/#c88b75/#d38e5e   baked=#bd8477/#c88b75/#1f1b23
  [ 1..13]   identical
  3057 buildings: wp identical 3057/3057, wf identical 3057/3057
```

One bucket, one channel: **`wn`, the night wall colour, of palette entry 0.**
Entry 0 is the protected tone — the Texas Capitol's Sunset Red granite, which
`js/facades.js:893-901` exempts from the fourteen-most-populous cut so that a
one-off landmark material is not averaged into its neighbours' tan.

`#d38e5e` is floodlit granite. `#1f1b23` is unlit granite. The two paths
disagreed about whether the Capitol is lit after dark.

### Why

`js/capitol.js:180-182`, inside `mergeCapitolScene`:

```js
if (CAPITOL.floodWall && Array.isArray(addParts.facade_protect)) {
  for (const spec of addParts.facade_protect) spec.wn = CAPITOL.floodWall;
}
```

The browser **mutates the protected spec's night colour** to
`CAPITOL.floodWall` (`#d38e5e`) before registering `window.FACADE_PROTECTED`, so
the list `quantiseFacades` elects over is not the list sitting in
`data/capitol_parts.geojson` (whose `facade_protect.wn` is `#1f1b23`).
`scripts/bake_facades.py:226` read that file raw and never applied the override,
so the shipped palette transcribed a scene the browser never sees.

The override is deliberate, argued and counted, at `js/capitol.js:107-121`: the
bake's dark value is conservative because the protected bucket is keyed on the
DAY colour and a neighbour in the same hue cell would be floodlit too — and the
count of such neighbours is one 12.5 m building, against the Capitol being "the
only lit thing in Austin that actually looks lit".

So the intent is the floodlight, the file records the caution, and nobody
noticed the two had come apart, because **the guard was refusing the file**. The
bug was hidden behind the bug.

### It was already caught, by a check nobody had run

`scripts/verify/facade_parity.py`, on a fresh browser capture, before any fix:

```
wp exact matches       3057 / 3057
*FAIL - 1 finding(s)
   palette[0].wn: python #1f1b23 vs browser #d38e5e
```

That gate has been red. It is green now.

---

## 4. The fix, both halves

**`js/facades.js` — `adoptBaked` re-applies protected tones from the live spec**,
exactly as step 2b of the election does, looking each one up by its coarse key
in the baked index and refusing the whole palette if the index has no bucket for
it. This is general, not a Capitol patch: anything that registers a protected
tone now gets its exact runtime colour on the baked path too, whatever computed
it and however late it ran. It also means the scene stays correct against a
palette baked *before* the override existed.

**`scripts/bake_facades.py` — the bake transcribes the override.**
`capitol_flood_wall()` parses `floodWall: '#rrggbb'` out of `js/capitol.js` and
`load_scene()` applies it to a deep copy of `facade_protect`, so the shipped file
matches the election. It raises `SystemExit` rather than defaulting if the
constant moves — a bake that quietly falls back to the dark value is precisely
the failure being fixed. `data/capitol_parts.geojson` is another lane's file and
was not touched.

Belt and braces on purpose: the bake keeps `facade_parity.py` honest, the JS
keeps the *scene* right regardless of what the file says.

`data/facade_palette.json` re-baked: `snapshot` `2026-08-03` -> `2026-08-16`, and
`palette[0].wn` `#1f1b23` -> `#d38e5e`. Every other byte unchanged — all
fourteen `wd`/`wg`, thirteen `wn`, and all twenty bucket entries.

---

## 5. Gates

| Check | Before | After |
|---|---|---|
| `harness-drift.mjs` | PASS (29 scripts, both files) | PASS |
| `facade-parity.mjs` pass A (port) | 3057/3057 `wp`, 14 buckets | same |
| `facade-parity.mjs` pass B (switch) | **FAIL** `palette entries 1 DIFFER` | **PASS** all 14 identical |
| `facade_parity.py` | **FAIL** `palette[0].wn python #1f1b23 vs browser #d38e5e` | **PASS** |
| `snapshot_parity.py` | 5 pass, 1 stale-but-equal | 6 pass, 0 stale-but-equal, 0 FAIL |

Both failures above are the real, watched failures of the shipped tree — not
contrived ones. Pass B asserts `facadePaletteSource()` reads `baked 2026-08-16`
before its diff is believed, which is what stops a silent fallback from passing
loudest.

---

## 5b. The visual bar: does arming the fast path move a pixel?

Frames in `shots/palette/`. One browser session, order **A1 B1 A2 B2** so the
noise floor is measured in the same session as the across-arm number. Arm A is
`?bakedfacades=0` (the election, what the site does today), arm B is the bake
armed. 1200x800, hardware GL. Each pose waits for the `austin-buildings` source
count to **stop changing** and then for the frame's strided luma probe to stop
moving (`drift < 0.02`) before it is read.

**The first draft of this gate was wrong and it is worth writing down.** It
waited for `> 300` source features against a settled 7,923, photographed a
half-streamed city, and reported 950,000 px of "difference" between two runs of
the *same* build. The fix is in the wait, not in the tolerance.

Settled building counts per pose, which is the first thing to read:

```
A1  5721 5721 5798 5798 7923 7747     fully settled
B1     0    0 3072 3072 7002 7747     STARVED - see below
A2  5721 5721 5798 5798 7923 7747     fully settled
B2  5721 5721 5798 5798 7923 7747     fully settled
```

**B1 is a bad run and is reported rather than dropped.** On a machine with
another lane's Chromes on it, that page never got its buildings: the Capitol
poses read *zero* source features. Every anomaly in a B1 column below traces to
that and to nothing else. The honest comparison is the one between the two runs
that both settled — **A2 vs B2** — with A1 vs A2 as its noise floor.

```
pose                  A1-A2 noise    B1-B2 (B1 starved)   A1-B1 (starved)   A2-B2 ACROSS
capitol-day             IDENTICAL             IDENTICAL         IDENTICAL      IDENTICAL
capitol-night         208px max48          478px max117      250px max117    129px max31
city-day                 0px max2              0px max2          2px max3       2px max3
city-night              IDENTICAL          6331px max127     6331px max127      IDENTICAL
southmall-eye-day       IDENTICAL             IDENTICAL         IDENTICAL      IDENTICAL
southmall-eye-night     IDENTICAL             IDENTICAL         IDENTICAL      IDENTICAL
```

**Four of six poses are byte-identical across the arms**, including both South
Mall eye-level frames and `capitol-day`. `capitol-night` — the pose the whole
finding is about — differs across arms by **129 px of 960,000 (0.013 %), max
channel delta 31, which is *below* its own within-arm noise floor of 208 px /
max 48**. `city-day` is 2 px against a floor of 0 px / max 2.

### And the check that does not depend on tiles arriving at all

A pixel diff on a busy machine measures streaming as much as colour, so the
same question was put to the renderer directly: dump every resolved
fill/fill-extrusion paint property under both arms, at day (`p=0.35`) and night
(`p=0.92`), and compare.

```
A source: forced off by ?bakedfacades=0
B source: baked 2026-08-16
palette arrays identical: YES (all 14)
paint properties compared over 196 layer/phase pairs — 0 differ
PASS — same palette, same paint expressions, day and night.
```

Identical palette plus identical paint expressions plus identical `wp`/`wf` on
all 3,057 buildings means no pixel can differ for a palette reason. **The visual
bar is met.**

---

## 6. What this page does NOT establish

* **The 1.2 ms was measured on a busy machine** (38 Chrome / 4 node / 93 % CPU
  at the start). The minimum-of-interleaved-reps discipline is what makes the
  comparison survivable, not the absolute numbers. Nobody should quote 5.20 ms
  or 4.00 ms as this app's election cost on a quiet machine.
* **End-to-end boot time was not measured.** See §2.
* **No other consumer of `FACADE_PROTECTED` was audited.** Today the list has
  exactly one entry, from `data/capitol_parts.geojson`. The `adoptBaked` loop is
  written to handle more, but more have never existed.
* **`scripts/bake_outer_facades.py` and `data/outer_tower_palette.json` were not
  examined.** The outer ring snaps to this same campus palette and has its own
  baked file with its own adoption path; whether it has the same protected-tone
  hole is an open question and another lane's file.
* **One of the four photographic runs (B1) was starved and is not evidence
  either way.** The verdict rests on A2 vs B2, one settled pair, plus the paint-
  property comparison. A third settled pair on a quiet machine would be better.
* **The parse of `js/capitol.js` is a regex.** It fails loudly, but it is a
  regex, and the right long-term shape is for the floodlit value to live in the
  data file the bake already reads.
