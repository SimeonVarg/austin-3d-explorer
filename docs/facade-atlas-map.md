# Facade atlas map — for the build lane, not a summary

Read-only pass, no browser. Everything below is quoted from source; anything not
derivable from code alone is marked as such. Written against `main` at the time
of reading (`js/facades.js` last touched by `d9b6d20`).

## 1. How `js/facades.js` generates a pattern image

**One image per `(family, colour-bucket, hour)` combo — never per feature.**
`rawTile(fam, bucketIdx, p)` (facades.js:1474) caches on the exact string key
`fam + '|' + bucketIdx + '|' + p` (line 1475) and draws once into a shared
canvas; every feature that shares a `wp` id and the current hour reads the same
registered MapLibre image. Features are pre-sorted into buckets by
`quantiseFacades` (line 913) — see §5 below.

**Pixel dimensions**, decided by three constants, all at the top of the file:
- `TILE = 64` (line 44) — drawing units per repeat, in "64-space".
- `SCALE = clamp(round(devicePixelRatio), 1, 2)` (line 168) — so `RES = TILE *
  SCALE` (line 169) is **64 or 128 texels square**, whichever the device needs.
- Each registered tier is that raw `RES×RES` buffer **box-decimated** by an
  integer `tier.div` (`decimate()`, line 1521) down to `RES / tier.div`. With
  the current two tiers (`div: 2` far, `div: 1` near — line 156-157) that's
  **32 or 64 texels** at `SCALE=1`, **64 or 128** at `SCALE=2`.

`tileData(fam, bucketIdx, p, tier)` (line 1543) is what actually gets handed to
`map.addImage`/`updateImage`: it takes `rawTile`'s cached buffer, decimates for
that tier, runs the per-family low-pass (`softenTile`, described in §4), and
returns `{ width: res, height: res, data }` as a **view**, not a copy (line
1549 comment explains why — MapLibre copies on its own side regardless).

## 2. `window.FACADE_PATTERN_EXPR` — what it actually is

**A zoom `step` expression built once at load, not a constant and not a bare
`get`.** facades.js:2456:

```js
window.FACADE_PATTERN_EXPR = window.facadeTierExpr(['coalesce', ['get', 'wp'], 'mh00']);
```

`facadeTierExpr` (line 1785) wraps any base id expression in:

```js
['step', ['zoom'], suffixed(baseId, TIERS[0].id), TIERS[1].minZoom, suffixed(baseId, TIERS[1].id)]
```

i.e. `['step', ['zoom'], concat(wp,'x'), 17, wp]` today (TIERS below). This is
evaluated by MapLibre **per tile at that tile's own zoom** — not per frame, not
per camera zoom (facades.js:1751-1768, `activeTiers()` comment: past ~60° pitch
MapLibre picks a tile zoom **per tile** by distance, and this app spawns at
pitch 74, so one frame can carry tiles at z13-z18 simultaneously).

**Layers that read `window.FACADE_PATTERN_EXPR` directly:**
- `buildings-3d`, the core building layer (js/app.js:595, toggled at
  app.js:2467/2471).
- `js/westcampus.js:1025` (`wc-` layer) — shares the core atlas verbatim.

**`js/outer.js` builds its own tier-wrapped expressions**, not the same object,
but through the same machinery: `joinBuckets()` (outer.js:285-294) does
`window.facadeTierExpr ? window.facadeTierExpr(match) : match` around a
`['match', ['get','fb'], ...]`, so `L_TOWER` and `L_MID` are equally
zoom-stepped and mip-aware. `towerPattern` even defaults to
`window.FACADE_PATTERN_EXPR` itself before the palette resolves
(outer.js:278).

**Every OTHER layer that paints `fill-extrusion-pattern`, and whether it is
tier-aware — this is the load-bearing finding:**

| file | what it draws | pattern expr | own atlas? | tier/mip chain? | low-pass (`SOFTEN`)? |
|---|---|---|---|---|---|
| `js/drag.js:633` | PCL, Gregory Gym, Union, Co-op, Guadalupe streetwall | `['get','wp']` **raw** | yes, `dg-` ids | **NO** | **NO** |
| `js/moody.js:536` | Moody Center, 2x Dell Med | `['coalesce',['get','wp'],'health-body-grey']` **raw** | yes, own | **NO** | **NO** |
| `js/tower.js:1471` | **UT Tower shaft + Main Building** | `['get','pat']` **raw** | yes, own `TILE=64` (tower.js:558) | **NO** | **NO** |
| `js/heroes.js:868-874` | EER, Dell CS, PCL-adjacent "hero" buildings | per-family `IMG.*` constant | yes, `TILES[id]` | not evident | not evident |
| `js/arts.js:334,344` | Ransom Center panels, Bass Concert Hall glass | `PANEL_IMG`/`GLASS_IMG` constant | yes, 2 images only (77/79 bands are flat colour, no pattern at all) | n/a | n/a |
| `js/places.js:429` | misc "places" glass | `GLASS_IMG` constant | yes, own `TILE=64` (places.js:162) | not evident | not evident |
| `js/ground.js` | paving/water/herringbone **ground**, not walls | various | yes | n/a (not a wall pattern) | n/a |
| `js/capitol.js:430` | mirrors `ground-texture` onto the Capitol extrusion | `GL_TEX` | mirrored, not a window grid | n/a | n/a |

**Read this table plainly: `drag.js`, `moody.js` and `tower.js` are each their
own closed pattern system**, with their own `TILE=64` canvas, their own
`addImage` calls, and **no reference to `facadeTierExpr`, `TIERS`, or `SOFTEN`
anywhere in the file** (checked by grep, not by search). A `['get','wp']` with
no tier suffix resolves to the *near*-tier key by construction — TIERS[1].id is
`''` (line 157), so `suffixed(base,'') === base` — meaning these three modules
are drawing the **full-resolution near tile at every zoom**, with none of the
mip-chain or per-family blur that facades.js's own header says is required to
keep the pattern below its own aliasing floor (§4). **`tower.js` is directly
relevant to Simeon's own report** — *"the bottom of the tower is having the
same window glitching problem"* — because the Tower's shaft bands are drawn by
`tower.js`, not by `facades.js`, and carry none of the mitigation the core
system has.

## 3. Could the pattern switch on zoom via `["step", ["zoom"], ...]`?

**It already does**, for the core system and outer.js — that mechanism IS
`facadeTierExpr`/`TIERS` (facades.js:146-158):

```js
const TIERS = [
  { id: 'x', div: 2, minZoom: 0,  soften: 0.0 },   // far — half res
  { id: '', div: 1, minZoom: 17, soften: 0.75 },   // near — full res
];
```

A second variant per combo is exactly what a tier IS: `suffixed(baseId, id)`
(line 1770) produces `wp+'x'` and `wp` as two distinct registered image keys
for the same combo, and `ensureImages()` (line 1794) registers both.

**A third tier is mechanically a one-line push to `TIERS`**, but is constrained
by a fact the file states was found the hard way (lines 123-134):
`pixelRatio` is stored in a MapLibre vertex attribute declared
`Uint16`/`a_pixel_ratio_from`, and `displaySize = texels / pixelRatio` must
come out to a **positive integer**. With the current `RES` (64 or 128 texels)
and `TIER_CSS = 32` (line 145), the only valid integer pixelRatios are 1 and 2
— which is why there are exactly two tiers today, not three (the file's own
title for that section: *"WHY THERE ARE TWO LEVELS AND NOT THREE"*). A third
level needs either a bigger `RES` (more texels drawn, i.e. `TILE` or the
`SCALE` cap raised) or a different `TIER_CSS`, and the assert at lines 179-187
(`console.error` on a non-integer/`<1` pixelRatio) is what would catch a wrong
choice — "the far field will render transparent" is the failure mode it names.

**Cost of a third tier**, from the file's own measurements: going from one
resolution to the current two-tier chain (repainting every tier per
time-of-day step, always, in the calling frame — see `paintTiers`, line 2116)
took `updateFacades` **57.7 ms → 119.7 ms** (line 1670), and the low-pass box
blur bought back only ~19 ms of that. A third tier adds one more `addImage`
call per already-registered combo (`ensureImages`, one iteration of the `for
(const t of TIERS)` loop, line 1797) and one more decimate+blur pass per combo
per repaint (`paintTiers`, same loop shape) — roughly proportional to the
number of combos in `combos` (§5), not to feature count.

## 4. The low-pass / anti-aliasing already built, and its own stated limits

Section "The windows crawl while the camera moves" (facades.js:1558-1638) is
an **earlier investigation of what reads as the same defect**, using an older
instrument (`scripts/verify/shimmer.mjs`, still present, distinct from
`scripts/verify/shimmer-aba-prototype.mjs` referenced by the current brief).
Its own measured numbers, worth knowing before re-deriving them:

- Removing `fill-extrusion-pattern` entirely (flat colour) cut the crawl
  roughly in half: bme-near 6.96%→3.41%, waggener-n 9.78%→6.06%, a 0.10 zoom
  step 40.23%→26.17%.
- The strongest blur tested (radius 6) recovers **almost all** of that
  headroom on the zoom-step case (38.72%→26.16%, against a 26.17% floor) but
  only a third of it on camera-translation cases, and radius 6 "visibly
  mushes the windows" up close — so it was rejected as too strong. The shipped
  `SOFTEN` constant (lines 1639-1656) is deliberately weaker than the value
  that reaches the floor.
- The file's own conclusion at the time: **"A single fixed tile cannot be both
  crisp near and quiet far. The complete fix is two tiers switched by zoom"**
  — which is what §3's `TIERS` chain then became (commit `f0a8fdc`,
  2026-08-04, "The mip tiers were three different window densities, not three
  resolutions").
- Despite that history, the current shimmer-brief (2026-08-21) reports the
  defect open **city-wide, after the tier chain and SOFTEN both shipped**.
  This map does not attempt to reconcile that — it is the fact the build lane
  needs going in: the documented fix reduced but is not proven to have
  eliminated the aliasing the current brief is measuring, and three modules
  (§2 table) never received the fix at all.

`SOFTEN` is per-family, taste-tunable (`window.FACADE_SOFTEN`, line 1656),
consistent with CLAUDE.md rule 11.

## 5. How many distinct pattern images exist, and atlas size

**Not cheaply derivable from source alone** — the palette is built at runtime
from the loaded buildings snapshot (`quantiseFacades`, per-session) plus
whatever `registerFacadeBuckets` callers add. What IS derivable, as bounds:

- `TARGET_BUCKETS = 14` (line 45) — the campus colour palette is capped at 14
  buckets, merged down from ~900 baked wall colours (module header, line 11).
- `window.registerFacadeBuckets` (line 2426) appends MORE palette entries for
  callers outside the campus snapshot, namespaced by `key` and idempotent per
  key (`_registeredSets` Map, line 2425). Known callers: `js/outer.js` for
  `'outer-tower'` (outer.js comment: "the downtown towers' **ten** baked
  buckets") and `'outer-midrise'` (count not stated in code — comes from
  `data/outer_tower_palette.json` at runtime).
- `combos` (referenced throughout, pushed to in `quantiseFacades` and
  `registerFacadeBuckets`) holds one entry per **actually-used** `(family +
  bucket-index)` pair, not one per palette slot × every family — so the true
  count depends on which families actually appear in the loaded data.
- Each combo in `combos` gets **2 images** (far `x` + near `''` tier) via
  `ensureImages`.
- On top of that, `drag.js` registers its own atlas: its own header states
  **"eleven to fifteen images"** (drag.js:17). `moody.js`'s header states
  **"eight images"** (moody.js:30). `tower.js`, `heroes.js`, `arts.js`,
  `places.js` each register a handful more, uncounted in comments.

All of these share **one MapLibre `ImageManager` atlas texture** for the whole
style — there is no per-module atlas at the GPU level, only at the
JS-registration level. A live count needs the browser (`map.style.imageManager`
/ `window.__map`); this map does not start one, per instructions.

## 6. The 2026-08-16 rework (referred to as "2026-08-19" in the task) — what it
   cached/gated, and what must not be undone

Commit `0a60dd0`, "MapLibre never forgets an updated image, and it cost 48 ms
of every frame" (2026-08-16), measured and fixed in `db987d4` the same day
(atlas main-thread share **40.5-52.1% → 1.9-3.0%**, cruise best frame **47.8 →
15.2 ms**). This is a **bookkeeping fix, not a pixel-content fix** — it does not
touch what the images look like or how they're sampled; it stops MapLibre's own
dirty-tracking from growing unbounded.

**The mechanism**, quoted (facades.js:1878-1902):

> `ImageManager.updateImage(id, img)` does `this.updatedImages[id] = true` ...
> **Nothing ever deletes from it.** One repaint marks it for the life of the
> page. `Tile.prepare(imageManager)` → `ImageAtlas.patchUpdatedImages` ... runs
> for EVERY loaded tile of EVERY source on EVERY render.

Measured: 385 marked keys held → 46.07 ms/frame doing 6M+ key scans; the set
emptied → 0.28 ms/frame; and in all 15,701 calls sampled, the number of images
that actually needed patching was **zero** — because a tile built after a
repaint is already current on arrival.

**The fix (`ATLAS.RELEASE`, facades.js:1904-2143):** once no in-view tile is
still holding an older image version — determined by `staleImageIds()`
(line 1999), which walks live tiles' `imageAtlas.patternPositions` /
`iconPositions` and compares `.version`, **never** a frame counter or a timer
— the marks are cleared from `im.updatedImages` (`releaseTick`, line 2045).
`noteTile` (line 2027) re-marks a single returning tile if it individually
needs it; a 30-frame (`rescanFrames`) belt-and-braces rescan exists for
anything that slips through.

**What the build lane must not undo, quoted directly:**

- `ATLAS.RELEASE.on` (line 1907) — *"Master switch. `window.FACADE_ATLAS
  .RELEASE.on = false` restores stock MapLibre behaviour live, for an A/B."*
  Any pixel-content fix must not flip this off, and must not add a new code
  path that calls `map.updateImage`/`addImage` in a way that bypasses
  `paintTiers`'s single `_relHold = ATLAS.RELEASE.holdFrames` reset
  (line 2141) — that line is what re-arms the hold after every legitimate
  repaint.
- **The authority stays `staleImageIds()`, not a guess.** The file states the
  wrong version of this already shipped once and had to be reverted: clearing
  marks without checking live tiles "showed the city at two different hours at
  once" (line 2059-2064 comment, and the whole A1/A4 section at lines
  1809-1855 describing that earlier, DIFFERENT, already-fixed bug — tile
  boundaries, not camera-move aliasing. Do not conflate the two: A1/A4 was a
  *step* discontinuity at tile edges from a stale mip tier holding the wrong
  HOUR; the current shimmer brief is a *flicker under camera motion at a
  single hour*, per shimmer-brief §2. They are different defects that happen
  to share the same TIERS/atlas machinery.)
- If a fix adds a THIRD tier or changes tier resolution (§3), `ensureImages`
  and `paintTiers` already loop `for (const t of TIERS)` generically — no
  per-tier-count assumption needs to change there. But any new per-frame or
  per-combo `updateImage` call that does not route through `paintTiers` (and
  therefore does not reset `_relHold`) risks leaving marks in
  `im.updatedImages` that `releaseTick` then has nothing to reconcile against,
  reintroducing the exact per-frame scan cost this rework removed.

## What this map does NOT establish

No browser was started for this pass (by design). Unconfirmed from code alone:
the live palette size, the live `combos` count, actual atlas texture
dimensions/megabytes, whether `heroes.js`/`arts.js`/`places.js` carry any
low-pass of their own (grep found no `SOFTEN`/`soften`/`mip` reference in those
three files, which is evidence of absence but not proof — a differently-named
mechanism could exist and was not searched for by name). Whether the
`drag.js`/`moody.js`/`tower.js` full-resolution-only pattern is a measurable
contributor to the city-wide crawl the brief describes, versus the core atlas
alone, is **not tested here** — it is a structural fact (no tier chain, no
SOFTEN) offered to the build lane as a place the leading hypothesis in
shimmer-brief §5 predicts a *worse* crawl, not as a confirmed second source.
