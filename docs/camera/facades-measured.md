# Facades at two metres, MEASURED — what survived contact with the app

Acer lane, 2026-08-06, branch `acer/facade-choice`. **No facade code changed.**
This is step 1 of `docs/camera/facades-at-two-metres.md`: half a day of
measurement and no fix.

Everything below was read off the running app at ONE named pose, written down
here so nobody has to look for it again. That plan's author could not find the
pose for the frame they measured, and said so; this file exists so that gap
closes.

---

## 0. THE HEADLINE, AND IT IS ALSO A CORRECTION

**The plan's arithmetic is right, and the plan is about the wrong layer.**

Every number in `facades-at-two-metres.md` — the 2.06 m repeat, the eight rows
of `mh` collapsed into 0.26 m storeys, the 43.6 % of wall area, the whole
family table — is arithmetic over `js/facades.js`. Checked against the app, that
arithmetic is correct to three decimal places.

But standing on the Guadalupe pavement at 1.7 m and looking at the streetwall —
the frame that whole document exists because of — **`js/facades.js` paints
2.9 % of the picture and nothing you can see.** The wall filling the top of the
frame is `drag-wall`, from `js/drag.js`, which carries **its own tiles at twice
the world scale** and whose stated design rule is that it draws **no horizontal
features at all**.

`shots/facade/12-WHO-PAINTS-THIS-WALL-magenta-drag-js-cyan-facades-js.png` is
the picture: paint `drag-wall` magenta and `buildings-3d` cyan, and the whole
upper wall goes magenta.

**Care, because the plan's frame is still poseless.**
`shots/eye/final/03-GUADALUPE-from-the-pavement-day.png` has no recorded pose —
that is the gap this pass was sent to close and it could only be closed forward,
by standing somewhere and writing it down. Shot 03 is the same corridor, the same
streetwall and the same view; its shopfront band, sign band and upper wall match
mine feature for feature; and its tenants (Potbelly, Wingstop) sit inside
`data/drag.geojson`'s extent. So the identification is a **strong inference for
shot 03** and a **measurement at the pose in section 1**. It is not a
measurement of shot 03, and it is not written as one.

Either way: the barcode above the shopfronts is not the `facades.js` collapse.
It is `js/drag.js` doing exactly what its header says it does.

---

## 1. THE POSE. WRITE THIS DOWN.

```
name        GUAD-24TH-PAVEMENT-WEST
eye         lng -97.74180   lat 30.28560   alt 1.70 m
bearing     270  (due west, across Guadalupe at the streetwall)
pitch       87
=>  map.getCenter()  [-97.74213782673931, 30.2856]
=>  map.getZoom()    20.68632215318673      floor(zoom) = 20
    fov 58, canvas 1440x900 css, devicePixelRatio 1, camPx 811.82
    mpp(floor 20) at this latitude = 0.064386 m per css px
page        _harness.html?intro=0 , applyTimeOfDay(p = 0.30, force)
browser     headless Chrome, --use-angle=swiftshader (chrome.mjs default),
            cancelGraphicsAutoDetect() at the top of every run, ONE at a time
gate        harness-drift.mjs PASS, 28 scripts in each file, before any pixel
```

Same spot at **pitch 86** → `zoom 21.1008468`, `floor(zoom) = 21`.

The plan predicted **20.69 / floor 20 at pitch 87** and **21.10 / floor 21 at
pitch 86**. Both land exactly. The zoom derivation in
`js/controls.js` is what the plan says it is.

---

## 2. THE REGISTERED IMAGES — READ OFF THE IMAGE MANAGER, NOT THE SOURCE

At this pose `map.style.imageManager.images` holds:

| module | images | texels | pixelRatio | **displaySize** |
|---|---|---|---|---|
| `facades.js` near tier (`mh01`) | 116 | 64 | **2** | **32 css px** |
| `facades.js` far tier (`mh01x`) | 116 | 32 | **1** | **32 css px** |
| outer ring / parts (`sp14`, `sp14x`) | 25 + 25 | 64 / 32 | 2 / 1 | 32 css px |
| stadium (`sd16`, `sd16x`) | 1 + 1 | 64 / 32 | 2 / 1 | 32 css px |
| **`drag.js`** (`dg-pclSolid-0` …) | **16** | **64** | **1** | **64 css px** |
| **`tower.js`** (`twbase~mb-base` …) | **66** | **64** | **1** | **64 css px** |
| **`heroes.js`** (`health-podium` …) | **12** | **64** | **1** | **64 css px** |
| **`places.js`** (`pl-glass`) | **1** | **64** | **1** | **64 css px** |

`TIER_CSS` = 32, confirmed live. So `facades.js` is exactly what its comment
claims: two tiers, one scale, `displaySize` 32 for both.

**The finding nobody had written down: the city carries TWO wall scales, and
they differ by exactly 2:1.** `drag.js`, `tower.js`, `heroes.js` and `places.js`
all call `map.addImage(id, tile)` with **no `pixelRatio` option**, so their
64-texel tiles register at pixelRatio 1 and cover **64 css px** per repeat —
double `facades.js`. That is not a bug in any one file; it is a convention that
was never shared. It matters here because the plan's whole cost model is
`displaySize` and it assumed one number for the city.

(Combo count: 116 facades.js combos are registered at this pose, not the 142 the
plan reconciled from HANDOFF's 284 images. The plan flagged that it had not
verified 84 of them. 116 is what a Drag/campus pose actually loads; the full
284 presumably needs a flight that touches every district.)

---

## 2b. THE TILE ZOOMS IN ONE WALKING FRAME, WHICH IS WHAT DECIDES THE SEAM

`austin-buildings` is a GeoJSON source with `maxzoom: 16`
(`js/app.js:441 PATTERN_TILING`), so its *canonical* tile zoom stops at 16 and
everything above that is overscaled. Both numbers matter and they are not the
same number. At the measured pose, in one frame:

| | canonical `z` | overscaled `z` |
|---|---|---|
| `austin-buildings`, reading 1 | 13, 14, 15, 16 | 13, 14, 15, **17** |
| `austin-buildings`, reading 2 | 11, 13, 14, 15, 16 | 11, 13, 14, 15, **25** |
| `austin-drag`, same frame | 11, 13, 14, 15, 16 | 11, 13, 14, 15, **25** |

**One walking frame samples tile zooms four to fourteen levels apart, and the
spread is not stable between readings on the same pose.** `['step', ['zoom'],
…]` on a `*-pattern` property is evaluated per tile at the tile's zoom, so
anything that steps on zoom splits *this* frame. That is the mechanism behind
QUEUE H2, and it is alive at walking height, not only at flying pitch.

(Reading canonical `z` alone would have said the near tier — `minZoom` 17 — can
never be selected for this source. Section 4 shows it is selected for 98.8 % of
the wall. **Quote overscaled `z` when you are talking about which image a tile
picks.**)

---

## 3. THE WORLD REPEAT, MEASURED

### The instrument

A **calibration tile**: 64x64 texels, one 2-texel magenta column at u = 0, one
2-texel cyan row at v = 0, flat grey elsewhere, registered at the same
`pixelRatio` as the tier under test so its `displaySize` matches exactly. Every
repeat boundary on the wall is then marked unambiguously. `fill-extrusion-
vertical-gradient` off, every other layer hidden, silhouette by hide-diff so the
mask is the layer under test and nothing else.

`shots/facade/_r-*.png` are the raw frames.

### What is confirmed, and it is the structure

| | measured | predicted | agreement |
|---|---|---|---|
| double `displaySize` (pr 2 -> pr 1) | repeat x **2.0019** | x 2 | **0.1 %** |
| one integer zoom (floor 20 -> 21) | repeat x **0.5008** | x 0.5 | **0.2 %** |

So `repeat_metres = displaySize_css x mpp(floor(cameraZoom))` is exactly the
rule the app obeys. The plan's formula is correct.

### The absolute number

At `floor(zoom)` 20 the prediction is `32 x 0.064386` = **2.0604 m** of wall per
repeat for anything on the `facades.js` scale, and **4.1208 m** for anything on
the `drag.js`/`tower.js` scale.

**Measured, on `buildings-3d` at `displaySize` 32, four independent walls:**

| wall | length (source geometry) | repeats across it | **repeat** | vs predicted 2.0604 |
|---|---|---|---|---|
| University Presbyterian Church, N face | 43.609 m | 21.103 | **2.0664 m** | **+0.3 %** |
| University Presbyterian Church, S face | 43.463 m | 20.926 | **2.0770 m** | **+0.8 %** |
| unnamed block | 19.540 m | 9.418 | **2.0749 m** | **+0.7 %** |
| UPC return, 24.8 m | 24.810 m | 11.478 | 2.1616 m | +4.9 % — one stripe missed (px gap 26.5 → 40 across the run), quoted for honesty and not averaged |

**And the same three walls at `displaySize` 64**, which is the `drag.js` /
`tower.js` / `heroes.js` / `places.js` scale, against a prediction of 4.1208 m:
**4.1326 m (+0.3 %), 4.1538 m (+0.8 %), 4.1447 m (+0.6 %)** (and 4.4130 m on the
same short wall that dropped a stripe above).

**THE PLAN'S ARITHMETIC IS CORRECT.** 2.06 m of wall per repeat at
`floor(zoom)` 20 on the `facades.js` scale, and 4.12 m on the other one,
measured three ways each within 0.8 %.

The ruler: a wall's footprint edge length is exact, straight out of
`querySourceFeatures`. How many pattern repeats fit between its two ends is
`L / repeat` and **perspective cannot change a count**. Only the two corners are
projected, and `map.project` is exact for a ground point; the fractional repeat
at each end comes from the local stripe spacing, a first-order correction over
one stripe. A missed stripe is visible as a doubled pixel gap and is reported
rather than smoothed away.

Which means, at this pose, on anything `facades.js` paints:

| family | rows | **floor-to-floor at 1.7 m** |
|---|---|---|
| `mh` (campus halls, streetwall mid-rise) | 8 | **0.258 m** |
| `tg` (curtain wall) | 10 | **0.206 m** |
| `mr` (walk-ups) | 6 | 0.344 m |

and on anything `drag.js` / `tower.js` / `heroes.js` / `places.js` paints, twice
those numbers, because their repeat is 4.12 m.

### The instrument that was NOT good enough, because it matters

The first reading unprojected the stripe positions onto the ground plane at the
wall's base row. **At 60 m and pitch 87, one pixel of base-row error is about
three metres of DEPTH**, i.e. ~5 % of scale, and the mask edge that supplies
that row is only good to a couple of pixels. Its own self-check disagreed with
itself by 24 %. Its *ratios* are trustworthy — the depth error is common to
every gap in a frame — and that is where the two rows in the table above come
from. Its *absolute* is not, and it is not quoted as one.

---

## 4. WHICH TIER IS LIVE AT 1.7 M

The plan predicted: *"at walking height every visible tile is on the near tier.
The far tier is unreachable … the tier chain is inert here."*

**Confirmed, with a control that can fail.** Every `facades.js` near-tier image
was overwritten in place with flat RED and every far-tier image with flat BLUE
(`updateImage`, 116 of each), with `buildings-3d` as the ONLY visible layer, and
the counts taken inside its own hide-diff silhouette:

| | pixels | share of the wall |
|---|---|---|
| near tier (red) | **372,136** | **98.81 %** |
| far tier (blue) | 4,483 | 1.19 % |
| silhouette | 376,627 px, 29.06 % of frame | |

`shots/facade/13-WHICH-TIER-red-near-blue-far.png`. The near wall is solid red;
the one blue patch is the block further down the street at frame right, which is
exactly where a far tier belongs. So the control is live — blue is not zero
because the instrument is broken, it is 1.19 % because that is how much far tier
there is.

**A first version of this probe passed vacuously and it is worth naming.** Run
with every layer visible, it reported 113,599 "red" pixels and 0 blue — which
looked like a clean confirmation and was nothing of the kind: `facades.js`
paints no visible pixel at that pose at all, and the 113,599 were the red awning
and the red labels. The reading only means something once the layer under test
is the only thing on screen.

**Consequence for the plan:** the near tier is 64 texels, so metres per texel at
this pose is `2.0604 / 64` = **0.0322 m**. The plan said 0.032. Its
"there is no resolution shortage" conclusion stands, and option **(a) higher-
resolution tiles is correctly rejected**.

---

## 5. WHO PAINTS THE FRAME

Two independent instruments at the same pose, all layers visible:

| layer | hide-diff | magenta paint | share of frame |
|---|---|---|---|
| `drag-wall` + `drag-cap` (js/drag.js) | 338,129 px | 311,738 px | **24–26 %** |
| `buildings-3d` (js/facades.js) | 37,031 px | — | **2.9 %** |
| `wc-wall` (js/westcampus.js, facades.js scale) | — | 602 px | 0.05 % |

The two instruments agree within 8 % on `drag-wall`, which is the number that
matters. `buildings-3d` at 2.9 % is slivers between the drag buildings — in the
magenta render it is not visibly anywhere.

**The picture is `12-WHO-PAINTS-THIS-WALL-...png`** and it is unambiguous: the
entire upper wall is magenta.

### Why that changes the problem

`js/drag.js`'s own header states the rule that produces the barcode, and it is
deliberate:

> *EVERY TILE IS STATIONARY IN Y. A band here is 1-9 m tall against a tile that
> spans 30-59 m … So no tile below draws anything that varies with y. Piers,
> mullions, fins, reveals and jambs are vertical and survive. Arch heads, window
> heads, sills and string courses are horizontal and are simply not drawn.*

That was the right call for a camera 200–900 m away. At 1.7 m it is the whole
defect: **a wall with vertical members and, by construction, no horizontal
ones.** The `retUpper` family — 14 features, the shop upper floors along
Guadalupe — is what the top of shot 03 is made of.

So the fix for the frame Simeon is looking at is a `js/drag.js` job, not a
`js/facades.js` one, and it is a much smaller job than the plan costed: **14
features and one tile function**, against 2,453 buildings and seven families.

---

## 6. THE TIER SEAM

The plan says one frame decides between its option (b2) — a one-storey close
tile, which deliberately breaks the "a tier may change resolution, it may not
change scale" invariant — and (b3)/(c). So: register the one-storey tile twice,
once at `displaySize` 64 and once at 32, and put a `['step', ['zoom'], …]`
between them, which is exactly the shape (b2) would ship.

**The first version of this was unreadable and I nearly reported a seam from
it.** The step frame showed two window scales side by side — and so does any
frame with two buildings at two distances, because perspective makes the further
one smaller. **A frame with a step in it and a frame without one look the same
to the eye.** The clue that it was worthless: moving the step from tile zoom 16
to 15 produced a **byte-identical** frame.

So the instrument became a three-way at one pose: **all-64, all-32, and the
step.** Anything that differs between the step frame and the all-64 frame is
exactly the pixels that took the other branch.

| pose | step frame vs **all-64** | step frame vs all-32 |
|---|---|---|
| looking north up Guadalupe, `cut` = 16 | **0 px** | 135,700 px, 10.47 % |
| head-on at the measured pose, `cut` = 16 | **0 px** | 160,736 px, 12.40 % |

(`shots/facade/44-SEAM-down-step-at-tile-zoom-16.png` and
`44-SEAM-headon-...png` are the step frames; `_s-*-all64.png` and
`_s-*-all32.png` are the two controls. The all-32 column is the proof the
instrument works: switching every tile to the other scale moves 10–12 % of the
frame, so a real seam would have been visible.)

**At `cut` = 16 there is no seam at all — because there is nothing to seam.**
Every tile carrying a visible wall at walking height is already above the step,
so the whole frame takes one branch and the step frame is pixel-identical to the
un-stepped one. The far branch is reached only by tiles that carry no visible
wall.

**Where the boundary really lands is section 4's number.** The shipping step is
at tile zoom 17, and the tier probe measured **98.81 % of the wall on one side
and 1.19 % on the other**, with the 1.19 % sitting on the block furthest down
the street. So if (b2) shipped, at this pose it would put a different window
scale on **about one per cent of the wall, on the most distant building in
frame** — and it would move as you walk.

**Verdict on the plan's question: the seam is not the reason to reject (b2).**
It is small, it is far away, and at this pose it is zero. The reason to be
careful about (b2) is a different one, and it is in section 8: a screen-locked
pattern cannot hold a storey height at more than one zoom, so a one-storey tile
is correct at exactly one `floor(zoom)` and is a two-storey or a half-storey
tile one zoom either side. That is not a seam between tiles; it is the whole
image being wrong the moment the camera climbs.

---

## 7. THE TWO CANDIDATE WALLS

The plan's one question for Simeon is *"how close is the Drag meant to survive —
do you want to read windows, or is a wall with real storey lines enough?"*, and
it says to show him the two side by side before he answers. These are the two,
photographed from the same pose in the same light, with the modelled shopfront,
the awnings and the sign band **untouched** — only the wall above them changes.

| | picture |
|---|---|
| what you have today | `shots/facade/20-CHOICE-0-TODAY-the-wall-you-have.png` |
| **A — WINDOWS** | `shots/facade/21-CHOICE-A-WINDOWS-one-storey-per-repeat.png` |
| **B — STOREY LINES, no windows** | `shots/facade/22-CHOICE-B-STOREY-LINES-only-no-windows.png` |
| the control that proves it is scale, not drawing | `shots/facade/23-CONTROL-the-same-windows-at-todays-scale.png` |

Both candidates are ONE repeat = ONE STOREY: a 64-texel tile at `displaySize`
64, so 4.12 m of wall per repeat at this pose and 1 texel = 6.4 cm. A is a
head reveal, jambs, a glazing bar, a sill and a 0.58 m spandrel — a 1.3 x 2.4 m
window comes out **20 x 37 texels**, which is enough to draw. B is the same
spandrel and floor line with bay piers and no openings at all.

The wall tone in both is the **real** one, taken as the mean of the shipping
`mh01` tile at this hour (`183, 162, 133`), so the comparison is about rhythm and
not about colour.

**Shot 23 is the argument for the whole plan in one frame.** It is candidate A's
drawing at *today's* 2.06 m repeat instead of 4.12 m, and it puts two storeys of
windows in the height of one — a doll's house. Same drawing, half the world
scale, and it stops reading. Nothing about the tile is wrong; the number of
metres it is stretched over is.

**These are mock-ups, not an implementation.** They are drawn in the page at
runtime by a scratch script, applied over the shipping layers, and nothing in
`js/` was edited. They exist so the taste question can be answered from
pictures.

---

## 8. WHAT SURVIVES OF THE PLAN, ITEM BY ITEM

| # | claim in `facades-at-two-metres.md` | verdict |
|---|---|---|
| 1 | zoom is derived; pitch 87 at 1.7 m gives z 20.69, floor 20; pitch 86 gives z 21.10, floor 21 | **CONFIRMED exactly** (20.68632, 21.10085) |
| 2 | one repeat = `TIER_CSS x mpp(floor(cameraZoom))` = `2,160,294 / 2^zoom` m | **CONFIRMED.** Doubling `displaySize` doubles it (x2.0019); one integer zoom halves it (x0.5008) |
| 3 | that is 2.06 m of wall at floor 20 and 1.03 m at floor 21 | **CONFIRMED**, 2.066 / 2.077 / 2.075 m measured on three walls |
| 4 | near tier is 64 texels at pixelRatio 2, `displaySize` 32; far tier 32 at pr 1 | **CONFIRMED** off the image manager |
| 5 | metres per texel at walking height is 0.032 m — there is no resolution shortage | **CONFIRMED** (2.0604 / 64 = 0.0322), and the near tier really is what paints |
| 6 | option (a), a higher-resolution atlas, does not fix the defect | **CONFIRMED** — it follows from 5 |
| 7 | "at walking height every visible tile is on the near tier; the far tier is unreachable; the tier chain is inert here" | **CONFIRMED**, 98.81 % near / 1.19 % far inside the wall silhouette |
| 8 | `mh` puts 8 storeys in 2.06 m = 0.258 m floor-to-floor | **CONFIRMED as arithmetic** on the confirmed repeat |
| 9 | "the stripes in shot 03 are `mh`'s 17 full-height verticals at 0.121 m" | **WRONG, and this is the correction.** Shot 03's wall is not `mh` and not `buildings-3d`. See 5 and below. |
| 10 | 142 registered (family x bucket) combos | **NOT what this pose loads** — 116 `facades.js` combos are registered here. The plan flagged it had not verified 84 of them. |
| 11 | Y4 (`ZOOM_MAX` 25) would push the repeat to 0.13 m | **not measured**, but it follows from the confirmed formula. Still true. |
| 12 | 70.4 % of core wall area is above 4.2 m; the family/area table | **not checked** — offline arithmetic over the snapshot, out of scope here |

### What the frame is actually made of

`drag.js`'s `retUpper` — the family on the shop upper floors along Guadalupe,
14 features — draws, per repeat: **6 bays each carrying a 2-texel full-height
"window", plus 5 full-height weathering streaks 2–4 texels wide.** Eleven
full-height verticals and, by the module's rule, nothing horizontal.

At `displaySize` 64 one texel is `4.1208 / 64` = 0.0644 m, so at 1.7 m that is:

| | at spawn (floor(zoom) 16) | **at 1.7 m (floor(zoom) 20)** |
|---|---|---|
| one repeat | 65.9 m of wall | **4.12 m** |
| bay pitch | 10.99 m | **0.687 m** |
| "window" width | 2.06 m | **0.129 m** |
| mean spacing of all 11 verticals | 5.99 m | **0.375 m** |

**A 12.9 cm dark stripe every 68.7 cm, running unbroken from the sign band to
the parapet.** That is the barcode, in numbers, and it is a sixteen-fold
collapse of a drawing that is correct at the altitude it was authored for.

### And the reason it cannot be fixed with a horizontal in the same tile

`js/drag.js` already worked this out and wrote it down as rule 2: a band 1–9 m
tall against a tile spanning 30–66 m shows an arbitrary horizontal SLICE of that
tile, and *which* slice moves as you zoom. So a storey line drawn into the tile
lands at a different height at every zoom. **A screen-locked pattern cannot hold
a storey height at more than one zoom** — that is the real constraint, it applies
to `facades.js` exactly as much as to `drag.js`, and it is why horizontal rhythm
has to come from a zoom-dependent image (the seam question), from a second
camera-zoom cross-faded layer (the plan's (b3)), or from geometry (the plan's
storey bands). It cannot come from a better drawing in the tile we have.

---

## 8b. WHAT THIS CHANGES ABOUT THE SEQUENCING

Not the recommendation — that is the plan's, and (a) is still correctly
rejected, (c) storey bands is still the highest ceiling. What moves is **scope
and order**:

1. **The Drag is a `js/drag.js` job.** 14 `retUpper` features and one tile
   function, not 2,453 buildings and seven families. If the goal is "make the
   frame Simeon is looking at good", that is the cheapest useful thing on the
   list by an order of magnitude, and the plan costed it as the expensive one.
2. **`js/facades.js` still needs the same fix**, for campus and West Campus,
   where `buildings-3d` and `wc-wall` really do paint the wall. It is just not
   what shot 03 shows.
3. **`tower.js` and `heroes.js` are on the 4.12 m scale and nobody has stood
   under either.** The UT Tower at eye level is unphotographed.
4. **The 2:1 scale split should be written down or removed** before anyone
   reasons about "the atlas" as one thing again. It is a one-word fix in four
   files (`{ pixelRatio: 2 }`) or a deliberate decision to keep two scales — but
   it should be a decision, not four independent omissions.

## 9. WHAT I DID NOT DO

* **Did not fix anything.** No file under `js/` was touched. Every candidate
  tile in section 7 is drawn in the page at runtime by a scratch script and
  exists only as a photograph.
* **Did not measure the repeat on `drag-wall` directly.** The attempt is in the
  run and it failed honestly: at 16 m the Drag streetwall fills the frame, its
  two corners are off-screen, and only three repeats are visible — below the four
  the ruler needs. Its repeat of **4.12 m is derived**, not measured: the law
  `repeat = displaySize x mpp(floor(zoom))` is confirmed at both `displaySize`
  32 and 64, and `drag.js`'s images read back from the image manager at
  `displaySize` 64. That is a sound derivation and it is not the same thing as a
  measurement, so it is labelled.
* **Did not measure at night.** Everything here is `p = 0.30`. The plan's open
  question about the lit-pane scatter at 0.13 m panes is still open.
* **Did not check the plan's wall-area table** (70.4 % above 4.2 m, the family
  x buildings census). That is offline arithmetic over the snapshot and nothing
  here contradicts it — but nothing here confirms it either, and it is now
  arithmetic about a layer that paints 2.9 % of the Drag frame.
* **Did not run `zfight.mjs`, `places-check.mjs` or `coplanar.mjs`.** No
  geometry changed, so none of them is a gate on this pass, and QUEUE Y14 still
  records them as unrun.
* **Did not measure on a real GPU.** Every frame here is SwiftShader, headless,
  1440x900, dpr 1. That is right for pixel assertions and says nothing about
  frame cost.
* **Did not re-measure `updateFacades`.** The plan's 80.4 ms baseline is
  untouched and unverified by this pass.
* **Did not look at West Campus, downtown or the Tower at eye level.**
  `tower.js` and `heroes.js` are on the 4.12 m scale and nobody has photographed
  either from a pavement.
* **Two instruments in this pass produced confident answers that meant
  nothing**, and both are written up above rather than deleted: the
  unproject-at-the-base-row repeat (24 % self-inconsistency), and the first tier
  probe (a control that could not fail because the layer under test painted no
  visible pixel). Neither reached a conclusion, but only because they were
  checked.
