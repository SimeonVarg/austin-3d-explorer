# Coplanar audit — the crash fixed, and the first human look at the pairs (QUEUE N5d)

Branch `acer/f-coplanar`, 2026-08-22. Port 8632, one headless Chrome at a time,
`_harness.html?intro=0&drift=0`, `cancelGraphicsAutoDetect()` on every load,
`harness-drift.mjs` green (30/30 scripts) before any pixel work. All frames at
p 0.25 daylight.

## Part 1 — the "Set maximum size exceeded" crash is fixed

**What it was.** `check()` bucketed every top face into THREE buckets (k-1, k,
k+1) and deduped revisited pairs with a `seen` Set of string keys. That Set is
O(eps-close candidate pairs). `data/trees.geojson` alone (67,443 features,
canopy tops quantised — a spike at exactly 17.00) puts **6,400,378** entries in
it on today's bake, measured with an instrumented copy. V8 hard-caps a Set at
2^24 = 16,777,216 entries, so a denser bake or a wider `--eps` dies.

**Reproduced, not assumed:** `node coplanar.mjs data/trees.geojson --eps 0.05`
on the OLD code throws `RangeError: Set maximum size exceeded` at
`Set.add`, coplanar.mjs:381 — the exact line the crash reports named. The FIXED
code completes the same invocation (225 pairs, no crash).

**The fix** (scripts/verify/coplanar.mjs): each item now lives in exactly ONE
bucket (its own rounded key); candidate pairs are drawn within a bucket and
against buckets +1 and +2. Two keys shared an old-style bucket iff they differ
by <= 2, so the candidate set is IDENTICAL — but each unordered pair is visited
exactly once *by construction*, so there is nothing to dedup and no memory that
grows with pair count. (It also does strictly fewer pair iterations: the old
walk visited a same-key pair three times and skipped two by Set lookup.)

**Proof the answers did not change:**
- `--selftest`: all 14 assertions pass, including a NEW selftest 9 that pins
  the pairing walk itself — a same-key pair, a bucket-boundary pair (tops
  0.0011 m apart, keys 1000/1001), a beyond-eps pair in the +2 bucket that must
  NOT hit, and a trio of identical footprints that must produce exactly 3 hits
  (the old triple-bucket walk visited those pairs 9 times and relied on the Set
  to report 3; here 3 must fall out of the walk).
- Old vs new `--dump-pairs` on the full 28-file default sweep: **2,429 pairs
  each, and the sorted multisets are byte-identical** — every one of the 2,429
  matches exactly.
- `--gate` behaviour unchanged: still red with exit 1 on exactly the known Y24
  regression (`entrances.geojson 1627 -> 1655`). The baseline file is NOT
  touched — Y24 is explicit that the fix is a bake fix, not a baseline edit.
- `--dump-pairs` records now carry `ia`/`ib` (feature indexes) alongside `eid`;
  additive, nothing that read the old shape breaks.

## Part 2 — what the RUNNING app actually loads (the bake trap, checked)

Captured from the live page's own network requests (not from reading code):
the app fetches 18 top-level geojsons directly, **buildings and parts come from
`data/snapshots/2026-08-22/…` via `manifest.latest`**, five layers stream from
`data/tiles/*.pmtiles` (trees, roads, outer, roofdetail, props — their
top-level geojsons are the tile *sources*, not what is fetched), and
`entrances.geojson` + `campus_storeys.geojson` load DEFERRED (first idle + 2 s,
alt < 60 m, or a 25 s ceiling) — a short network capture will miss them, ours
initially did.

**First-ever sweep of the snapshot files the visitor actually sees:**
`buildings.detailed.geojson` (2,453 features) and `parts.detailed.geojson` (16)
— **0 coplanar pairs in either.** The city's primary building stock is clean;
nobody had ever checked it because the default sweep only reads `data/*.geojson`.

Every file that DOES carry pairs feeds the renderer (directly or through its
tile bake), so all 2,429 are in-scope. By family:

| family | pairs | biggest (m² shared) |
|---|---|---|
| entrances door trim (reveal/surround/step/…) | 1,655 | 22 m² |
| stadium internal bowl (seat/seat 176, pier/lintel 107, wall final_height 20, …) | 313 | 15,414 m² |
| outer ring (plaza pads 166, ground bands 8, twin buildings 4, crown 1) | 179 | 161,468 m² |
| trees canopy/canopy | 99 | 311 m² |
| art parts | 92 | 64 m² |
| roofs | 85 | 42 m² |
| capitol dome/parts, ground, heroes, places | 7 | 613 m² |

## Part 3 — the top 15, photographed in the running app

`shots/f/coplanar/r01…r15*.png`. One representative per family-slice, ranked by
shared area. **On-screen proof per frame** (the house rule): the red box is the
pair's own projected bbox; `queryRenderedFeatures` inside it must return both
members (the `members` count), and hiding the source's layers must change the
box's pixels (`changed`, grabbed off the GL canvas; `noise` is the same frame
grabbed twice). For three pairs the members were additionally deleted from the
live source one at a time (`setData`, then restored) — the doorstack method.

| # | pair | where | members | changed / noise | verdict |
|---|---|---|---|---|---|
| 1 | outer plaza pads, 161,468 m², top 0.45 | Lady Bird Lake south shore | 39 | 33.5% / 1.1% | **Harmless in practice** — both pads carry the identical palette (`#8fa869/#8a9457/#111a14`), so whichever face wins the depth fight paints the same colour. Wasteful bake, invisible fight. |
| 2 | outer plaza pads, 47,074 m², 100% | Festival Beach | many | (same family) | Same: identical palette, invisible. |
| 3 | DKR wall ring vs `final_height` faces, 15,414 m², top 34 | DKR north facade | 7 | 27.3% / 0.0% | **Real doubled geometry, no visible artifact found.** With `stadium-wall`+`stadium-wall-roof` hidden, a second full-height wall remains on the same footprint (`_stadwall-band-off.png`) — two wall systems coexist, tops coincident at 34 m. Stills show no comb; deleting the fascia band changes 4.2% of the box, so it is on camera. Owner if it ever shows: the stadium/buildings bake. |
| 4 | outer ground band r/r, 6,520 m², top 5.2 | west of downtown | ✓ | 36%* | Ground-floor band overlaps, background district. No artifact in the still. |
| 5 | two whole buildings superposed, 3,133 m², 100%, top 15.9 | Mueller (by the lake) | 2 | 67.3% / 0.0% | **The one pair worth an eyeball**: two different-coloured buildings (`#b18e7e` vs `#d3d2c6`) occupy one block at one height — which wall/roof wins any pixel is depth-buffer luck. The still looks stable; the risk is pose-dependent flicker in a district a visitor only sees from afar. |
| 6 | stadium seat decks, 1,090 m², top 20.6 | DKR bowl | 2 | 89.7% / 0.0% | Internal bowl geometry, same seat palette; bowl reads clean. Harmless. |
| 7 | outer tower crown vs its own shaft top, 892 m², top 59.4 | Rainey St area | 4 | 71.5% / 0.0% | Coplanar **by design** — `k='c'` crown "sits on the shaft" and ends at the same 59.4 m. Tower renders clean. Latent, same family as the dbase/dh trim overlap the schema documents. |
| 8 | capitol wing parts, 613 m², 100%, top 28 | Capitol west wing | 4 | 65.1% / 0.0% | Stacked wing parts, same palette, drawn by parts-3d/parts-roof. Clean in frame. Harmless. |
| 9 | dome drum vs cornice ring, 523 m², 100%, top 60 | Capitol dome | 2 | 42.6% / 0.0% | Stacked drum rings sharing a top by construction. Dome renders clean. Harmless. |
| 10 | tree canopies, 311 m², top 11.1 | Rosewood park | 3 | 35.0% / 0.0% | Overlapping canopy polygons, identical palette. Invisible. (97 more like it.) |
| 11 | hero band pair, 131 m², top 28.6 | Norman Hackerman | 4 | 59.1% / 0.0% | Hero building's own band/cap overlap; facade reads clean at street framing. Harmless. |
| 12 | creek canopies, 96 m², top 15.2 | Shoal Creek | 2 | 68.2% / 0.0% | Same-palette canopy overlap. Invisible. |
| 13 | art parts, 64 m², top 5.4 | near Blanton/PCL | 11 | 45.2% / 0.0% | Sculpture sub-parts sharing tops; piece renders clean. Harmless. (92 pairs, all sub-metre-to-tens-of-m².) |
| 14 | pitched roof pieces, 42 m², 100%, top 22.2 | Gregory Gym NW corner | 9 | 78.8% / 0.0% | **Proven buried**: deleting one member changed 0.00% of pixels — it lies entirely under the big hip roof. Harmless duplicate. |
| 15 | the Y24 doubled doorway (eid 345 + eid 621), 22 m², top 4.2 | Moncrief-Neuhaus seam | 2 (qRF) | see below | **Buried today.** Deleting ALL 35 of eid 621's features changed **0.00%** of pixels at NINE poses (five frontal at z19.6–20.2, three from the south, plus the audit pose); the control — deleting eid 345 instead — also 0.00%, and point-probes show the doorway a visitor CAN see at that corner belongs to eid 347/281. Both duplicated door groups sit inside the building seam. The 28-pair gate regression is real in the data and stays owned by the entrances bake (Y24); it is not currently a visitor-visible defect. |

*rank 4's changed% recorded from its winning bearing during the sweep; box
proof same method as the rest.

## The verdict a sentence long

**Nobody had looked, and now somebody has: none of the 2,429 baselined pairs is
a visible defect a visitor can meet today.** The two families that are real
doubled geometry (DKR's double wall, the Y24 doorway) are both fully covered or
buried on the current build; the two biggest-area families (plaza pads, tree
canopies) fight over faces painted the identical colour; the rest are
stacked-by-design rings and trims. The instrument's value is as a REGRESSION
gate — a NEW pair against this baseline is the thing to chase, not the stock.

## Not established

- No zfight.mjs flicker sweep at these 15 poses — stills and layer/feature
  A/Bs only. A camera-in-motion comb at a grazing angle (esp. rank 5's
  two-colour twins and rank 3's double wall) is the remaining way one of these
  could show; nothing in the stills suggests it.
- Night frames: all photographs are p 0.25 daylight. Emissive glass at night
  could in principle leak through the buried doorway seam; not measured.
- The pmtiles archives were not decoded and diffed against their source
  geojsons; pairs in trees/outer are asserted against the tile *sources* the
  repo builds from, at the same commit.
- Which layer draws DKR's `final_height` wall (snapshot buildings-3d vs
  another) was not traced to code; the second wall's existence is proven by
  pixels, its owner only inferred.
- Why the crash was hit "twice this week" at default eps: today's default sweep
  peaks at 6.4M of the 16.8M cap on this data, and completes. The overflow
  reproduces at `--eps 0.05` (and would at a denser trees bake); whichever
  data state tipped it that week is no longer on disk. The failure mode itself
  is gone either way — there is no Set to overflow any more.
