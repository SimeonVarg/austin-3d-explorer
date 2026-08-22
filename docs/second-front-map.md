# The second shimmer front — six files, mapped

Read-only pass, no browser, no server. Everything below is quoted from source
on `main` as checked out for this task; line numbers are exact at time of
reading. Companion to `docs/facade-atlas-map.md` (which already covers the
core atlas and first flagged this front in its §2 table) — this doc goes one
level deeper, per file, for the build lane that ports the fix.

## 0. Correction to the task's own premise: `js/westcampus.js` is not part of this front

The task listed `js/westcampus.js` as "0 refs, 1 pattern layer" alongside the
other five. That count is wrong. `js/westcampus.js:1025`:

```js
'fill-extrusion-pattern': window.FACADE_PATTERN_EXPR,
```

This is the literal global `facades.js` builds — the same tier-stepped,
`SOFTEN`-blurred expression `buildings-3d` reads (`docs/facade-atlas-map.md`
§2 already says this: *"`js/westcampus.js:1025` — shares the core atlas
verbatim"*). It has zero local `SOFTEN`/`facadeTierExpr`/`TIERS` *string*
matches only because it never needed its own copy — it imports the finished
expression by reference. It already got 100% of `shim-lowpass`'s benefit for
free, the same day that PR merged. **Do not spend any build-lane effort on
westcampus.js for this defect; it is not the second front, it is already
inside the first one.** The real second front is five files, not six.

## 1. `js/drag.js` — PCL, Gregory Gym, Texas Union, Co-op, Guadalupe streetwall

**Layer / expression.** One pattern layer, `drag-wall` (`L_WALL`, drag.js:624,
id set at line ~90). Paint at drag.js:633:

```js
'fill-extrusion-pattern': ['get', 'wp'],
```

A raw per-feature `get`, no `coalesce`, no `step`. `wp` is stamped onto every
`kind:'wall'` feature by `stampPatterns()` (drag.js:526-542) *before*
`addSource`, one id per `(fam, wd)` combo, e.g. `dg-pclCoffer-0`. The other
two layers on this source (`drag-cap` line 647, `drag-detail` line 666) paint
flat `fill-extrusion-color`, not a pattern — **only one of the file's three
layers is a pattern layer**, not two; the task's count of 2 was the header
comment at line 22 (prose, not a paint key) plus the real one.

**Image production.** Canvas, drawn fresh, not baked. `tileData(combo, p)`
(drag.js:478-516): a module-singleton 64×64 `willReadFrequently` 2D context
(`_canvas`/`_ctx`, created once, line 479-486, comment explains why not a
second composited canvas — 44ms→230ms in facades.js's own measurement),
`TILES[combo.fam]` draws into it, then a block-mottle pass is written
straight into the `getImageData` buffer (not composited), then copied to a
`Uint8Array`. **Dimensions: 64×64, fixed** — `const TILE = 64` (drag.js:86),
no `devicePixelRatio` scaling at all (facades.js scales `RES` by clamped DPR;
this file does not).

**Caching.** None across repaints. `registerImages()` (line 544) calls
`tileData` once per combo only if `!map.hasImage`, but `applyDragColors()`
(line ~716-722) calls `tileData` again, unconditionally, on every
time-of-day tick and feeds it straight to `map.updateImage`/`addImage` — same
frequency class as `facades.js`'s own repaint, just with no intermediate
raw-tile cache (facades.js's `rawTile` caches the pre-decimate draw so two
tiers share one draw call; drag.js has one resolution so there is nothing to
share, but it also means adding a tier here means adding the caching facades.js
already had to build, not just the decimate/blur math).

**Finest real-world feature.** The file's own header states it explicitly and
argues about it at length (drag.js:76-92): PCL's coffer piers are drawn at
**2 px** against a real pier of **1.3 m** — "the openings are WIDER than the
piers... the bay is drawn at roughly double the real pitch." At the file's own
calibration (~0.63 m/px, "middle of the flying range"), that 2 px pier is
≈1.25 m of drawn geometry, already a resolution-limited stand-in for something
finer. Gregory Gym's arcade void (`GYM_VOID: 5` px, line 108) and the PCL
panel joint (`PCL_JOINT: 0.055`, an alpha not a width) are coarser. **~1.3 m
pier stroke is the finest declared feature.**

**`addImage`, pixelRatio.** Yes — `map.addImage(c.id, tileData(c, p))` (line
548) and `map.updateImage(c.id, tileData(c, p))` (line 720). **No `pixelRatio`
option anywhere in the file** (grepped for the string, zero hits) — defaults
to MapLibre's implicit 1.

## 2. `js/tower.js` — UT Tower shaft + Main Building

**This is the file Simeon named** ("the bottom of the tower is having the
same window glitching problem").

**Layer / expression.** One pattern layer, `tower-wall` (`L_WALL`,
tower.js:1467), filtered `['all', HAS_PAT, NOT_DETAIL]`. Paint at
tower.js:1471:

```js
'fill-extrusion-pattern': ['get', 'pat'],
```

Raw `get`, no fallback, no step. The other two layers on this source
(`tower-solid` line 1485, `tower-detail` line 1500) are flat
`fill-extrusion-color` — again **one pattern layer, not two.**

**Image production.** Canvas, drawn fresh, same shape as drag.js.
`tileData(fam, trio, p, seed)` (tower.js:632-?): singleton 64×64
`willReadFrequently` context (line 633-636), `FAM[fam]` (line 582-589) drives
a `strip`-only painter (x-only pitch/width/darkness — no vertical structure
at all, by the file's own design note at line 567-572), then the same
block-mottle-into-buffer pattern as drag.js. **Dimensions: 64×64 fixed** —
`const TILE = 64` (tower.js:558), no DPR scaling.

**Caching.** None across repaints, same shape as drag.js:
`registerPatterns()` (line 740) registers once; `repaintPatterns()` (line
754) redraws unconditionally on every time-of-day tick via
`map.updateImage`/`addImage`.

**Finest real-world feature.** `FAM.twwall.strip = [7, 2, 0.42]`
(tower.js:585) — pitch 7 px, **width 2 px**. The header (line 567-572)
states the calibration directly: *"a 64 px tile covers 30-59 m of wall...
~7 px is a 3.5-7 m bay — which is the real bay on this building."* At that
same scale, the 2 px window/mullion width is **≈1.0-1.7 m** — this is the
Tower's actual punched-window strip, drawn at essentially the same texel
density as `facades.js`'s own near tier (the tier `shim-lowpass` improved
25-41% at). `twshaft`/`twplain`/`twvoid` (`strip: null`) have **no strip
structure at all** — they are the blank limestone shaft, cornice/balustrade,
and bell-chamber void, and cannot alias on a window grid because they don't
draw one. **`twwall`/`twbase`/`twattic` (2-4 px strips) are the alias risk;
they are also exactly the bands that carry the Tower's visible windows.**

**`addImage`, pixelRatio.** Yes, `map.addImage`/`updateImage` (lines 747,
760). No `pixelRatio` option anywhere in the file.

## 3. `js/arts.js` — Ransom Center panels, Bass Concert Hall glass

**Layer / expression.** Two REAL pattern layers, both using named-constant
image ids, not a per-feature `get`:

- `L_PANEL` (arts.js:330-338), filter `['==', ['get','lyr'], 'panel']`:
  `'fill-extrusion-pattern': PANEL_IMG` (line 334) — `PANEL_IMG =
  'arts-hrc-panel'` (line 111), one image for the whole building.
- `L_GLASS` (arts.js:340-350), filter `['==', ['get','lyr'], 'glass']`:
  `'fill-extrusion-pattern': GLASS_IMG` (line 344) — `GLASS_IMG =
  'arts-bass-glass'` (line 112), one image, Bass Concert Hall's lobby only.

No `step`, no `coalesce` — a bare constant string in both cases, because
there is only ever one image per layer (this whole file registers exactly
two pattern images, per `docs/facade-atlas-map.md` §2's own note: *"77/79
bands are flat colour, no pattern at all"*).

**Image production.** Canvas, `T = 64` (arts.js:147), singleton
`willReadFrequently` context (`ctx2d()`, line 149-159). `panelTile(p)` (line
177-208) fills a `panelCells × panelCells` grid (`ARTS.panelCells = 6`, line
66) of near-uniform cells separated by `panelJoint` px lines
(`ARTS.panelJoint = 1`, line 67); `glassTile(p)` (line 221-?) draws **eight
columns across the tile** for the Bass lobby's structural bay, explicitly
NOT the mullion (comment, line 213-219: *"Sized for the STRUCTURAL bay, not
the mullion... drawing it would draw a 3-5 m mullion — the same lie that
makes a 7 cm brick course come out as concrete block."*).

**Caching.** None across repaints — `ensureImages(map, p)` (line 251-257)
redraws `TILES[id](p)` on every call, same shape as the others.

**Finest real-world feature.** Two different answers for the two layers:

- Panel (`L_PANEL`): `panelJoint = 1 px` (arts.js:67), and the comment at
  that line states the metre value directly — **"One texel = 0.4-0.6 m,
  which is a real joint."** This is a genuine sub-metre single-texel stroke,
  the finest declared feature in any of the five files.
- Glass (`L_GLASS`): eight columns / 64 px tile over a 30-59 m span is a
  **~4-7 m structural bay** (the file's own header number) — coarse by
  design, the mullion was deliberately dropped a level below drawable.

**`addImage`, pixelRatio.** Yes (line 254-255). No `pixelRatio` option.

## 4. `js/places.js` — misc "places" glass (door/portal glazing, storefronts)

**Layer / expression.** One pattern layer, `L_GLASS` (places.js:424-436),
filter `['==', ['get','fam'], 'plGlass']`. Paint at places.js:429:

```js
'fill-extrusion-pattern': GLASS_IMG,
```

A bare constant, `GLASS_IMG = 'pl-glass'` (line 163) — one image for the
whole pass, same shape as arts.js's glass layer. The file's other four
`addLayer` calls (`L_WALL`-equivalent, `L_SOLID` line 382, `L_POOL` line
404, `L_ENTRY` line 417, `L_LABEL` line 438) are flat-colour extrusions or a
symbol layer, not pattern layers — **one pattern layer, not two.**

**Image production.** Canvas, `TILE = 64` (places.js:162), singleton
`willReadFrequently` context (line 262-267). `glassTile(p)` (line 255-296)
paints a flat glass base + optional night glow + shopfront-tenancy bay
scatter (6 bands, deliberately coarser than the mullion pitch so the two
"cannot beat against them," per the file's own comment at line 283-285),
then draws vertical mullion lines: `for (let x = 0; x < TILE; x += T.MULL)
fillC(ctx, mull, x, 1)` (line 294) — **1 px wide**, `T.MULL = 3` (line 178),
with the comment stating the real spacing directly: *"mullions every ~1.9 m,
1 px wide."*

**Caching.** None across repaints — `applyPlacesColors()` (line 593-596)
redraws `glassTile(p)` on every call.

**Finest real-world feature.** The mullion line itself: **1 px wide, drawn
every ~1.9 m** — a single-texel stroke, the same class of feature as arts.js's
panel joint. This file draws real punched-glazing structure (portal/door
glass), not just a coarse bay like arts.js's glass layer.

**`addImage`, pixelRatio.** Yes (line 348, 597). No `pixelRatio` option.

## 5. `js/moody.js` — Moody Center, 2× Dell Med

**Layer / expression.** One pattern layer, `moody-wall` (`L_WALL`,
moody.js:531-549), filter `['==', ['get','kind'], 'wall']`. Paint at
moody.js:536:

```js
'fill-extrusion-pattern': ['coalesce', ['get', 'wp'], 'health-body-grey'],
```

A `coalesce`-wrapped `get` with a literal fallback id — closest of the five
to `facades.js`'s own shape (`facades.js`'s base expr is also
`['coalesce', ['get','wp'], 'mh00']`), but still **not** wrapped in a `step`.
The file's other three layers (`L_ROOF`, `L_PLANT`, `L_CAP`, looped at line
552-564) are flat colour — **one pattern layer.**

**Image production.** Canvas, `TILE = 64` (moody.js:82), singleton
`willReadFrequently` context (line 388-393). `tileData(id, p)` (line
386-417) looks up a painter by `PAINTER_FOR[id]` from a `TILES` map keyed by
material name (`moody-plinth`, `moody-fins`, `moody-glass`, `moody-fascia`,
`health-podium`, `health-body`, `health-attic` — six distinct materials
across the two building types), draws, then copies out the same
getImageData→Uint8Array shape as the others.

**Caching.** None across repaints — `registerTiles()` (line 420-427) calls
`updateImage`/`addImage` with a freshly-drawn `tileData(id, p)` every call.

**Finest real-world feature.** This file states its own conversion factor
explicitly — `MOODY.designMetresPerTile = 45` (moody.js:72), i.e. **≈0.70
m/px** — and every `M.*` size constant is commented in both texels and
metres (moody.js:105 header: *"Sizes are in TEXELS at
MOODY.designMetresPerTile, so the metre figure in each comment is the thing
to argue with"*):

- `health-body` (Dell Med's punched-window rainscreen, measured off 1.86 Mpx
  of real elevation photography): `BODY_W: 4, BODY_H: 4` (moody.js:170-171)
  — a **4×4 px ≈ 2.8×2.8 m** window cell on a 9-row/6-col staggered grid.
  This is a real, photograph-calibrated window grid, the closest analogue in
  any of the five files to `facades.js`'s own near tier.
- `moody-plinth`: `PLINTH_JOINT: 9` px (~6 m) but "drawn as single-pixel
  verticals" (comment, line 111) — **1 px** stroke, same class as arts.js's
  panel joint and places.js's mullion.
- `moody-fins`: `FIN_PITCH: 4` px ≈ **2.8 m**, explicitly stated as "seven
  times the real spacing, because the real spacing is sub-texel" (line 118).
- `moody-glass`: `GLASS_MULLION: 5` px ≈ **3.5 m** bay.

**`addImage`, pixelRatio.** Yes (line 425). No `pixelRatio` option.

## Cross-file summary table

| file | pattern layers | expr kind | image ids | own atlas | finest feature | addImage pixelRatio |
|---|---|---|---|---|---|---|
| drag.js | 1 (`drag-wall`) | raw `get` | per-combo, `dg-*` | yes, 11-15 images | ~1.3 m pier (2 px) | none passed |
| tower.js | 1 (`tower-wall`) | raw `get` | per-combo `pat` | yes, own | ~1.0-1.7 m strip (2 px) | none passed |
| arts.js | 2 (`L_PANEL`,`L_GLASS`) | 2 named constants | fixed, 2 images | yes, own | 0.4-0.6 m joint (1 px, panel); 4-7 m bay (glass, coarse) | none passed |
| places.js | 1 (`L_GLASS`) | 1 named constant | fixed, 1 image | yes, own | ~1.9 m mullion (1 px) | none passed |
| moody.js | 1 (`moody-wall`) | `coalesce`+`get` | per-material, `wp` | yes, 8 images | ~2.8 m window cell (4 px), 1 px joints in `plinth` | none passed |
| westcampus.js | **not this front** — imports `window.FACADE_PATTERN_EXPR` verbatim | — | — | shared with core | already tier+soften covered | (facades.js's own, `tierPixelRatio`) |

Every one of the five draws a **64×64 canvas** (`TILE`/`T` = 64, identical
constant, same value `facades.js`'s near tier uses), reads it back with
`getImageData` through a lazily-created **module-singleton
`willReadFrequently` 2D context**, copies to a fresh `Uint8Array` every call,
and registers with `map.addImage`/`updateImage` **with no `pixelRatio`
option** and **no tier suffixing** — one resolution, sampled at whatever
minification the live camera produces, unconditionally. None cache the drawn
buffer across repaints (facades.js's `rawTile` cache is itself a facades-only
optimization, not present or needed here since there is only one resolution
per combo today).

## 6. Can one shared helper serve all five, or are they too different?

**A small, general helper — yes. A full port of facades.js's registration
machinery — no, and don't try.**

Read `js/facades.js`'s own three candidate functions directly (facades.js
lines 1521, 1761, 1847):

- **`decimate(src, res, div)` (line 1521) is already a pure function.** It
  takes a raw RGBA buffer, a resolution, and an integer divisor, and returns
  a box-averaged buffer at `res/div`. No reference to `combos`, `SOFTEN`, or
  any facades-only state. **Directly reusable as-is**, just needs to be
  exposed instead of trapped in the closure.
- **`softenTile(d, fam, tier, res)` (line 1761) does general math wrapped in
  facade-specific lookup.** The wrap-safe separable box blur (lines
  1771-1806) is pure — it only touches `d`, `res`, and the two numbers `r`
  and `a`. The *only* facades-specific part is lines 1762-1769, which
  resolve `r`/`a` from `SOFTEN.FAMILY[fam]`/`SOFTEN.RADIUS[fam]`/
  `SOFTEN.AMOUNT[fam]` — a lookup table keyed by facades.js's own five family
  codes (`lo/mr/mh/tr/tg`), meaningless to `drag-pclCoffer` or
  `moody-fins`. **Splitting this into `boxBlur(d, res, radius, amount)`
  (general) + a small per-caller radius/amount table (local taste, per
  CLAUDE.md rule 11 anyway) is a mechanical extraction, not a redesign.**
- **`facadeTierExpr(baseId)` (line 1847) closes over module-level `TIERS`.**
  The shape — `['step', ['zoom'], suffixed(baseId, tiers[0].id), tiers[1].minZoom,
  suffixed(baseId, tiers[1].id), ...]` — is generic MapLibre expression
  construction with zero facades-specific content once `tiers` is an
  explicit parameter instead of a closure variable.
- **`tierPixelRatio(t)`** (referenced at `ensureImages`, facades.js:1863,
  and documented at length in `docs/facade-atlas-map.md` §3 — the
  `displaySize = texels/pixelRatio` must-be-integer constraint, a Uint16
  vertex attribute limit) is **pure MapLibre math**, not facades-specific
  either — every one of the five files would hit the identical constraint
  the moment it added a second tier, since it comes from the engine
  (`docs/pattern-sampling.md` §2), not from `facades.js`'s own choices.

**What must NOT be centralized:** `ensureImages`/`tileData`
(facades.js:1543, 1856) are facades-specific — they call `parseId`, read
`combos`, and assume a `(fam, bucketIdx)` id scheme. Each of the five files
has its **own, different** id/combo bookkeeping (`drag.js`'s `_combos` array
keyed by `fam+'|'+wd`; `tower.js`'s `_pats` object; `arts.js`'s two named
constants with no per-feature id at all; `places.js`'s single constant;
`moody.js`'s `_tileColours` keyed by material name) and **different paint
expressions** (raw `get`, `coalesce`+`get`, and two bare constants — three
different shapes across five files). Forcing one shared registration loop
onto all of that would mean inventing a sixth id scheme none of them
actually has and rewriting every file's combo bookkeeping to match it — a
worse trade than the ~15-20 lines of glue each file would otherwise write
itself.

### Proposed helper

A new, dependency-free file, e.g. `js/pattern-tiers.js`, loaded **before**
`js/facades.js` in `index.html` (no circular-load-order problem: the helper
needs nothing from any consumer, and `facades.js` itself is the natural
first adopter, not required for this task but free if the build lane wants
it). Signature:

```js
window.PatternTiers = {
  // Pure. src is a Uint8ClampedArray/Uint8Array RGBA buffer, res x res.
  // Returns a same-shape buffer at (res/div) x (res/div).
  decimate(src, res, div),

  // Pure. Mutates `d` (RGBA buffer, res x res) in place with a wrap-safe
  // separable box blur of the given texel radius and blend amount.
  boxBlur(d, res, radius, amount),

  // Pure. tiers: [{ id, div, minZoom }, ...] — same shape as facades.js's
  // own TIERS (soften/family fields are the caller's business, not this
  // helper's). baseIdExpr: any MapLibre expression producing the near-tier
  // (undecorated) image id. Returns the wrapped `['step', ['zoom'], ...]`.
  tierExpr(baseIdExpr, tiers),

  // Pure. res: this tier's own resolution (post-decimate). designCss: the
  // CSS-px-per-repeat this pattern was authored at (each file's own TILE
  // constant divided by whatever bay-count it drew at — the file supplies
  // this, the helper does not guess it). Returns the integer pixelRatio to
  // pass to map.addImage's {pixelRatio} option, or throws/returns null on a
  // non-integer result (mirrors facades.js's own console.error-on-bad-ratio
  // guard, docs/facade-atlas-map.md §3).
  tierPixelRatio(res, designCss),
};
```

Each of the five files keeps its own `tileData()`/registration loop
unchanged in shape, and adds: one `decimate`+`boxBlur` call per extra tier
inside its existing draw function, one `tierExpr()` call where it currently
writes a bare `get`/`coalesce` expression, and one extra `addImage` call
per combo per tier with `{pixelRatio: PatternTiers.tierPixelRatio(...)}` —
the same shape of change `facades.js`'s own `ensureImages` already makes,
just written five times with five different id schemes feeding it, which is
the honest, unavoidable part of the port.

**This is not new architecture — it's promoting three functions that are
already pure out of a closure**, at effectively zero risk to `facades.js`
itself (it would need to be updated to call the shared version instead of
its own, or simply keep its private copies and let the new file be
five-files-only; either is fine, and neither risks the `ATLAS.RELEASE`
staleness system per `docs/facade-atlas-map.md` §6, since none of the
generalizable functions touch `im.updatedImages`, `staleImageIds`, or
`_relHold` — that bookkeeping is `facades.js`-only and stays there).

## 7. Where the pattern is NOT the crawl risk

**`js/arts.js`'s glass layer (Bass Concert Hall lobby)** is the one place in
this front where porting the machinery is likely pure cost. Its own header
says the mullion was deliberately dropped a level below drawable — eight
columns across a 64 px tile is a **4-7 m structural bay**, coarse by design,
not a fine window grid (arts.js:213-219). A pattern with no sub-2-px
structure has nothing to alias past `pattern-sampling.md`'s own threshold
("texel density exceeds one texel per screen pixel") until the camera is
extremely close — and it is one lobby facade on one building, the smallest
footprint of anything in this front. Its panel layer (Ransom Center) is the
opposite case within the same file — 1 px joints are real alias risk — so
the file cannot be dismissed wholesale, only its glass layer.

**`js/westcampus.js`** (§0 above) is not a crawl risk to fix here at all —
it already inherits the shipped mitigation.

## 8. Ranked by expected benefit

1. **`js/tower.js`.** Simeon named this specifically, and `twwall` draws a
   photograph-scale 2 px window strip with zero prefilter — structurally the
   closest analogue to `facades.js`'s own near tier (the one `shim-lowpass`
   measurably improved 25-41% on). Highest confidence this closes the actual
   complaint.
2. **`js/drag.js`.** Not named by Simeon, but the round-one measurement in
   this task's own brief put `street-drag` at 38-40% crawl — **roughly ten
   times every other measured pose**, untouched by round one. Highest
   *measured* ceiling of the five, and it is the single most-traveled camera
   path in the app (Guadalupe, the Drag).
3. **`js/moody.js`.** `health-body`'s 4×4 px window cell is a real,
   photograph-calibrated window grid on a highly visible building (Dell
   Med/Moody Center sit on the app's own flight paths); `moody-plinth`'s 1 px
   joints add a second alias source. Not measured yet, but structurally
   equivalent risk to tower.js, on a smaller building footprint.
4. **`js/places.js`.** Real 1 px mullion structure, but "misc places glass"
   is a smaller, more scattered footprint than a single named landmark —
   real risk, lower total screen area than the top three.
5. **`js/arts.js` (panel layer only).** 1 px joints on the Ransom Center are
   a genuine alias source, but it's one building, one flat cladding layer,
   not a window grid — lowest visible-area, lowest per-pixel drama of the
   four real risks.
6. **`js/arts.js`'s glass layer** — no meaningful fine structure, do not
   port machinery to it (§7).
7. **`js/westcampus.js`** — not part of this front at all; already fixed
   (§0).

## What this did NOT establish

- No runtime measurement of any of the five files' actual crawl percentage —
  everything above about "alias risk" is derived from the same
  source-confirmed mechanism in `docs/pattern-sampling.md` (sub-2-texel
  strokes at unfiltered `LINEAR`, no-mipmap sampling alias with zero
  tolerance), applied to each file's own declared feature sizes, not a
  `shimmer.mjs` run against any of them. The task specified read-only, no
  browser — this is the honest limit of that constraint.
- Did not check whether any of the five files' `_canvas`/`_ctx` singletons
  could collide with each other or with `facades.js`'s own if a shared
  helper's `boxBlur`/`decimate` were called across files in the same tick —
  each file keeps its own canvas singleton today and the proposed helper
  never touches canvas/DOM state, only raw buffers, so this should be moot,
  but it was reasoned from the code, not executed.
- Did not verify `arts.js` panel/glass counts, `moody.js`'s 8-image claim,
  or `drag.js`'s "11-15 images" claim against a live `map.style.imageManager`
  — taken from the files' own header comments, consistent with
  `docs/facade-atlas-map.md` §5's identical caveat for the core atlas.
- Did not estimate the atlas-generation (not per-frame) cost of adding a
  second tier to any of the five files — `docs/facade-atlas-map.md` §3
  gives facades.js's own real number for its two→three-tier step (57.7ms→
  119.7ms, `updateFacades`) as the closest available analogue, but these
  five files start from *one* tier each, not two, so their own zero→two
  step is a different, unmeasured jump.
