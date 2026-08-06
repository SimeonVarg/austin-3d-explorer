# Facades at two metres — why the Drag is a barcode, and what it costs to fix

Acer lane, 2026-08-05. Planning document for QUEUE **Y5**. No code, no browser,
no pixels changed. Everything below is arithmetic over constants that are in the
repo today, plus two frames I read off disk.

The frame this document exists because of:
`shots/eye/final/03-GUADALUPE-from-the-pavement-day.png`.

---

## 0. THE HEADLINE, AND IT IS A CORRECTION

The brief said the atlas "is being magnified enormously" at 2 m. **It is not.**
Measured against the constants:

| | at spawn (`floor(zoom)` = 16) | at walking height (`floor(zoom)` = 20) |
|---|---|---|
| metres per texel, near tier, dpr 1 | 0.515 m | **0.032 m** |
| metres per texel, far tier, dpr 1 | 1.030 m | (far tier not reachable) |

**The texture is sixteen to thirty-two times FINER at eye level than in the
flyover.** There is no resolution shortage. Every texel the atlas holds is
already smaller than a brick.

What actually breaks is the **world scale of the repeat**. MapLibre's
`fill-extrusion-pattern` is locked to the *camera zoom*, not to the world, and
this file already measured that and wrote it down (`js/facades.js`, the
`TIER_CSS` block: *"One repeat is `displaySize * 67551 / 2^floor(cameraZoom)`
metres of wall, the SAME number for every tile on screen"*). So:

```
one repeat  =  TIER_CSS (32 css px)  x  mpp(floor(cameraZoom))
            =  2,160,294 / 2^floor(zoom)   metres of wall
```

| `floor(zoom)` | 15 | 16 | 17 | 18 | 19 | **20** | **21** |
|---|---|---|---|---|---|---|---|
| metres of wall per repeat | 65.9 | **33.0** | 16.5 | 8.24 | 4.12 | **2.06** | **1.03** |

`TIER_CSS = 32` was chosen, in a comment, so that the repeat is **33 m at the
zoom the app spawns at** — which through `mh`'s 8 rows is 4.1 m floor-to-floor,
a real storey. That is the design point and it is correct.

At walking height the same drawing lands on **2.06 m or 1.03 m of wall**, so
`mh` puts **eight storeys in 2.06 m — 0.26 m floor-to-floor**. A sixteen- to
thirty-two-fold collapse. That is the barcode, and it is a *scale* defect, not a
*resolution* one.

**This kills option (a) before it is costed.** More texels make a 0.26 m storey
sharper. It is still 0.26 m.

---

## 1. WHY WALKING HEIGHT LANDS ON `floor(zoom)` 20–21

Zoom in this app is derived, not set (`js/controls.js:739`):

```
D = alt / cos(pitch)
z = clamp( log2( C * cos(lat) * camPx / (512 * D) ), ZOOM_MIN 14, ZOOM_MAX 21.5 )
```

with `C = 40030228.884`, lat 30.2836, `camPx = 811.82 px` at 1440x900 / fov 58
(the same 811.82 §105 read off the live transform). That reduces to
`2^z = 54,804,300 / D`.

At `ALT_MIN` = 1.7 m, `pitchFloorAt(1.7)` = 84.7 deg and `PITCH_MAX` = 88, so the
**entire reachable band at walking height** is:

| pitch | camera-to-centre `D` | zoom | `floor` | m per repeat |
|---|---|---|---|---|
| 88 (flattest) | 48.7 m | 20.10 | 20 | 2.06 |
| 87 (the pose in shots 03/72) | 32.5 m | 20.69 | 20 | 2.06 |
| 86 | 24.4 m | 21.10 | 21 | 1.03 |
| 84.7 (pitch floor) | 18.4 m | 21.50 = `ZOOM_MAX` | 21 | 1.03 |

There is **no pose at 1.7 m that reaches a sane repeat.** The whole band is
2.06 m or 1.03 m. Compare: spawn is 163 m / z16.5 → 33.0 m; the tour's downtown
leg is z15.2 → 65.9 m.

Two consequences worth naming:

* **The tier chain is inert here.** The near tier takes over at tile zoom 17, so
  at walking height *every* visible tile is on the near tier. The far tier is
  unreachable. The mip chain is a resolution mechanism and this is not a
  resolution problem, so it does exactly nothing for the defect.
* **Y4 makes it worse, slightly.** Raising `ZOOM_MAX` to 25 so you can look at
  your feet also pushes `floor(zoom)` to 24–25 at walking height, where the
  repeat is **0.13 m**. Whatever is done here has to survive Y4, and Y4 should
  not ship first.

**Corroboration, independent of my arithmetic.** `docs/camera/at-eye-level.md`
part 2 measured this from the recon frames at a 2 m eye, before the floor
landed, and reported *"a repeat that covers ~1.2 m of wall"*. That brackets
1.03 / 2.06 exactly.

---

## 2. THE FAMILIES, AND WHAT THE COLLAPSE DOES TO EACH

`GRIDS` in `js/facades.js` is in 64-unit drawing space. Converted to metres:

| fam | rows x cols | floor-to-floor @ z16 | window @ z16 | **f-to-f @ z20** | **window @ z20** | f-to-f @ z21 |
|---|---|---|---|---|---|---|
| `lo` | 2 x 3 | 16.48 m | 4.12 x 3.61 m | 1.030 m | 0.258 x 0.225 m | 0.515 m |
| `mr` | 6 x 5 | 5.49 m | 3.09 x 2.06 m | 0.343 m | 0.193 x 0.129 m | 0.172 m |
| `mh` | 8 x 5 | 4.12 m | 2.58 x 2.06 m | **0.258 m** | 0.161 x 0.129 m | 0.129 m |
| `tr` | 9 x 5 | 3.66 m | 2.58 x 2.06 m | 0.229 m | 0.161 x 0.129 m | 0.114 m |
| `tg` | 10 x 7 | 3.30 m | 3.09 x 2.58 m | **0.206 m** | 0.193 x 0.161 m | 0.103 m |
| `dk` | bands @ 13 px | 6.70 m pitch | — | 0.419 m | — | 0.209 m |
| `st` | 5 tiers | 6.59 m | — | 0.412 m | — | 0.206 m |

### The stripes are not the windows. They are the wall material.

Shot 03 shows **vertical stripes and no horizontal structure at all**, which the
window grid alone does not explain. `drawWallMaterial` and the `WALL.PIER` block
draw **full-tile-height** verticals: `WALL.STREAKS` weathering streaks at random
x, plus a lit+shadow pilaster pair at every window column boundary. Full height
in tile space is full height on the wall, because the tile repeats vertically.

| fam | full-height verticals per repeat | spacing @ z20 | spacing @ z16 |
|---|---|---|---|
| `mh` | 7 streaks + 5 pier pairs = **17** | **0.121 m** | 1.94 m |
| `tr` | 6 + 5 pairs = 16 | 0.129 m | 2.06 m |
| `mr` | 5 + 5 pairs = 15 | 0.137 m | 2.20 m |
| `tg` | 3 streaks, no piers | 0.687 m | 11.0 m |
| `lo` | 3 streaks, no piers | 0.687 m | 11.0 m |

At z16 that is a 2 m structural bay and it reads as one. At z20 it is a
corduroy line every **12 centimetres**, on a wall 30 m tall — roughly **250
full-height stripes**, which is precisely the frame. Meanwhile the horizontal
features (the 1-texel head shadow, the 1-texel sill) are **0.032 m tall** and are
further attenuated by `SOFTEN`: the near tier's radius rounds to 1 texel at
dpr 1 and **2 texels at dpr 2**, i.e. a 0.16 m box on a retina screen, which is
wider than the stripe pitch. On a high-dpi laptop the wall smears further.

So the read is: **full-height verticals survive the collapse and horizontals do
not.** That is the barcode, exactly.

### Who wears what

Core snapshot `data/snapshots/2026-08-05/buildings.detailed.geojson`, 2,453
buildings, families computed with `familyFor()` reimplemented offline:

| fam | buildings | % of buildings | wall area | % of wall area |
|---|---|---|---|---|
| `mr` | 1,596 | 65.1% | 893 k m² | 28.9% |
| `mh` | 418 | 17.0% | 1,345 k m² | **43.6%** |
| `lo` | 351 | 14.3% | 53 k m² | 1.7% |
| `tr` | 30 | 1.2% | 397 k m² | 12.8% |
| `dk` | 28 | 1.1% | 142 k m² | 4.6% |
| `tg` | 22 | 0.9% | 174 k m² | 5.6% |
| `st` | 8 | 0.3% | 84 k m² | 2.7% |

Plus the outer ring (`data/outer_ring.geojson`, 9,149 buildings):
**243 downtown towers → `tg`**, **645 streetwall mid-rise → `mh`**, and the
remaining **8,261 low-rise** are snapped in the browser by
`quantiseOuterFacades`, which prefers `tg`, then `mh`, then `mr` — so a large
share of suburban Austin is wearing the 10-row curtain-wall grid. At 2.06 m per
repeat that is a bungalow with 0.21 m storeys.

**Ranked by how badly it will be seen on foot:**

1. **`mh` — worst.** 1,063 buildings (418 core + 645 outer streetwall), **43.6%
   of core wall area**, the tightest vertical rhythm (0.121 m), and it is *both*
   the campus halls and the Drag streetwall. It is the family in shot 03.
2. **`mr` — most numerous.** 1,596 buildings, 65% by count. All of West Campus's
   low blocks and everything above the Drag's awnings.
3. **`tg` — smallest storey (0.206 m) and the only family exempt from
   `MIN_PIER`/`MIN_SPANDREL`** via `curtain: true`, so its mullions already sit
   at the pixel floor. 265 buildings by intent + a large slice of the 8,261
   low-rise by accident.
4. **`tr`** — only 47 buildings but 12.8% of core wall area, because they are
   tall; they are also the West Campus towers you stand under.
5. `lo`, `dk`, `st` — real but secondary. `lo` degrades most gracefully (big
   sparse openings, no pilasters, 0.69 m stripe spacing).

### How much of a facade is even at stake

**70.4% of core wall area is above 4.2 m** — above the modelled ground floor
(`WC_CAN_TOP_MAX`, the top of the entrances bake's canopy band). That is the
atlas's territory. The Drag corridor (126 buildings between 21st and 26th) has a
median height of 9.3 m and a mean of 12.4 m, so on the Drag the atlas owns
roughly two thirds of every elevation and the excellent modelled shopfront owns
the bottom third. §105 put it exactly right: *a 3 m stripe under 40 m of that.*

---

## 3. WHAT THE ATLAS COSTS TODAY

Measured, in `HANDOFF` §"the tier chain": after the H2 two-tier change,
**atlas texture 2,840 KB, 284 images**, and `updateFacades` **80.4 ms** (min of
5 interleaved reps, hardware GL, one page load each; was 135.8 ms / 6,816 KB /
426 images at three full-resolution tiers).

284 images / 2 tiers = **142 registered (family x bucket) combos.** That
reconciles to the byte for byte:

```
dpr 1:  near 64x64x4 = 16,384 B  +  far 32x32x4 = 4,096 B  =  20,480 B per combo
        20,480 x 142 = 2,908,160 B = 2,840 KB      <- exactly the measured figure
dpr 2:  near 128x128x4 + far 64x64x4 = 81,920 B per combo = 11,360 KB
```

Where the 142 come from: 58 from the campus snapshot (computed offline from
`data/facade_palette.json`'s 14 buckets x `familyFor`, verified against
`HANDOFF`'s parity line *"combos 64 / 64"*), 10 downtown tower buckets, 6
downtown mid-rise buckets, DKR's six per-elevation band families with their own
palette entries, plus West Campus, parts and the Capitol.

**The whole atlas is 2.8 MB and repaints in 80 ms.** That cheapness is the
current design's entire virtue and every proposal below is priced against it.

---

## 4. THE OPTIONS, PRICED

### (a) Higher-resolution atlas tiles — **reject, on measurement**

| near tier | bytes/combo | 142 combos, dpr 1 | dpr 2 | repaint |
|---|---|---|---|---|
| 64 texels (today) | 20,480 | **2.8 MB** | 11.4 MB | 80.4 ms |
| 128 texels (pr 4) | 69,632 | 9.4 MB | 37.7 MB | ~4x draw + blur |
| 256 texels (pr 8) | 266,240 | **36.1 MB** | 144 MB | ~16x |

The 256-texel atlas also needs a ~2816² packed texture, which is over the 2048
limit some weak GPUs report and close to 4096 on others.

**It does not fix the defect.** Metres per texel at walking height is already
0.032 m — eight times finer than at z17 and sixteen times finer than the far
tier at spawn. Spending 36 MB buys a sharper 0.26 m storey. Reject.

The one honest thing (a) *would* buy: on a dpr-2 screen the near tier is
minified 2:1 and carries a 0.75-unit blur for exactly that reason. Doubling it
would let `SOFTEN` go to zero there. That is a real but small win and it belongs
in a different pass.

### (b) A zoom-dependent atlas — cheap in bytes, and it knowingly re-opens H2

The lever that matters is **`displaySize`**, not texels. `displaySize =
texels / pixelRatio` and `pixelRatio` must be a whole number >= 1, so to hold a
given repeat in metres at high zoom you buy `displaySize`, and only then do you
need the texels to fill it.

There are two shapes, and they price very differently:

**(b1) Same drawing, bigger displaySize.** Keep the 8-row `mh` grid and make the
repeat sane at z20:

| target repeat @ z20 | displaySize | texels @ pr 1 | bytes/combo | 142 combos |
|---|---|---|---|---|
| 4.12 m | 64 css | 64 | 16,384 | 2.2 MB |
| 8.24 m | 128 css | 128 | 65,536 | 8.9 MB |
| 16.48 m | 256 css | 256 | 262,144 | 35.5 MB |
| 33.0 m (the design point) | 512 css | 512 | 1,048,576 | **142 MB — dead** |

**(b2) A different drawing: ONE STOREY PER REPEAT.** The close tile does not
have to carry eight rows. Author a single storey — head reveal, jamb, glazing
bars, sill, spandrel below — at `displaySize` 64 css px:

```
repeat @ floor(zoom) 20  =  64 x 0.0644  =  4.12 m of wall = one storey
64 texels at pixelRatio 1  ->  16,384 B per combo  ->  142 combos = 2.22 MB
metres per texel = 4.12 / 64 = 0.064 m
a 2.4 m x 1.5 m window = 37 x 23 texels
```

**That is the same byte cost as the near tier it replaces**, and it turns a
0.161 x 0.129 m smear into a 37 x 23-texel window with room for a head, a sill,
a reveal and a lit pane. It is by a distance the best value on this page.

**The cost, and it is the one this file has already paid once.** `js/facades.js`
states the invariant in capitals: *a tier may change RESOLUTION, it may not
change SCALE*, because past ~60 deg of pitch MapLibre picks a tile zoom **per
tile** and the pattern id is evaluated at the tile's zoom — so one frame samples
several tiers and a tier with a different `displaySize` puts a different number
of windows on the same metre of wall. That is the reported *"rapidly alternates
between the less and more dense window pattern on movement"*, and QUEUE H2 was
the pass that closed it. (b2) deliberately breaks that invariant.

How bad in practice: at 1.7 m / pitch 87 the near buildings are on high-zoom
tiles and the ones further down Guadalupe are on lower-zoom tiles, so **the seam
lands mid-street, in the exact frame this is meant to fix**. It would be a
content change, not just a density change, so it would be more visible than the
one H2 removed — but it would also be *stationary in the world* rather than
flickering, if the step is on tile zoom and the camera is walking rather than
flying.

**This is a testable question, not an argument.** Half a day: register the
one-storey tile as a third id, force it on at a fixed pose, photograph the seam.
If the seam is tolerable, (b2) is a two-to-three-session fix for 0 MB. If it is
not, (b2) is dead and we have spent half a day rather than a week.

**(b3) The seam-free variant, for completeness.** Draw the near-field walls in a
**second layer** whose `fill-extrusion-opacity` cross-fades on *camera* zoom —
paint properties are evaluated at the transform's zoom, uniformly across the
frame, so there is no per-tile split and no seam. The cost is a second
fill-extrusion pass over the same geometry (vertex count and fill rate roughly
double in the near field) and two coincident extruded surfaces, which is exactly
what `scripts/verify/zfight.mjs` exists to catch. Real, but I would not start
here.

### (c) Real window geometry — the highest ceiling, and the controlled experiment is already in the frame

Shot 03 **is the A/B**. The bottom of that picture — awnings, recessed
shopfronts, glazing, bollards, kerb, legible tenant fronts — is the entrances
bake, and it is geometry. The top of the same picture, same camera, same light,
is the atlas. One reads and one does not. §105 said the entrances work *"reads
far better at 2 m than at 18 m"*, which is the same statement from the other
side.

Priced against the existing bake, which is the only honest yardstick:
`data/entrances.geojson` is **11,777 features / 5.5 MB** for 584 doors, 24
lobbies and the shopfront run — about 470 bytes and ~20 features per opening.
`scripts/bake_entrances.py` is **3,600+ lines**. That is what a bake of this
class actually costs to write.

| scope | buildings | storey-levels | est. openings | est. features | est. size |
|---|---|---|---|---|---|
| **Drag corridor** (Guadalupe 21st–26th) | 126 | ~390 | ~4,700 | ~19,000 | ~9 MB |
| Campus core (Forty Acres) | 417 | ~1,220 | ~15,000 | ~59,000 | ~28 MB |
| West Campus | 723 | ~1,940 | ~23,000 | ~93,000 | ~44 MB |
| All three | 1,266 | ~3,550 | ~43,000 | ~171,000 | ~80 MB |
| Whole core snapshot | 2,453 | ~7,300 | ~88,000 | ~350,000 | ~165 MB |

(openings = storey-levels x ~4 street-facing elevations x ~3 windows per
elevation, at `mh` spacing; features = ~4 per opening for reveal / glass / head /
sill.)

**Honest scale.** The Drag alone is roughly the size of the entrances bake and is
therefore **two to four sessions** — one to write the opening-placement rule
against real elevations, one to bake and tune, one to verify and shoot. Anything
beyond one corridor is **a week-plus** and changes the load budget: it needs
PMTiles, a minzoom, an LOD story and a fresh perf pass, and none of that is in
the current shape of the app. City-wide per-window geometry is not a pass, it is
a project.

**The cheap middle of (c), which nobody has costed and which I think is the real
prize: STOREY BANDS, not windows.** Bake the horizontal structure only — one
recessed spandrel band and one lit head reveal per storey, plus the vertical bay
piers — as thin extrusions. That is O(storeys x elevations), not O(windows):
~3,550 storey-levels x 4 elevations x 2 bands = **~28,000 features, ~13 MB** for
the Drag + campus + West Campus together, comparable to `entrances.geojson`. It
gives the wall the thing the collapse destroys — **horizontal rhythm at a real
floor height** — while leaving the windows to the atlas. Combined with (b2) it
would be very strong, and each half is independently useful.

### (d) Accept it and gate walking height — cheap, honest, and not a strawman

The state of the evidence supports this more than it looks. §105's own verdict:
*"Would I walk around in it? Yes — on campus and on the Drag, day and night."*
The two best frames the project has produced (01 and 02) are campus at eye
level, and campus is where the geometry is. Nothing here is *wrong* — a texture
authored for one scale is being asked to work at another, and the honest
response to that is to say where the camera belongs.

Cost: hours, not days. A region-dependent `ALT_GROUND` / `ALT_MIN` — walking
height inside the Forty Acres and the Drag block, a higher floor elsewhere.

What it gives up: the two things Simeon most obviously bought when he chose
1.7 m over 8 m — West Campus at night (shot 05, one of the best in the set) and
the freedom to stop anywhere. And it does not fix the Drag, which is the frame
that fails.

I would rather state (d) as the fallback than pretend it is not on the table.

---

## 5. RECOMMENDATION

**Do (b2), then storey-band (c), and never do (a).**

1. **First, half a day of measurement, and no fix.** Stand at a named pose on
   Guadalupe, print `map.getZoom()` / `floor(zoom)` / the registered image's
   `pixelRatio`, and assert the world repeat from pixels against a wall of known
   width — magenta-mask the buildings layer first so we know which layer we are
   reading (HANDOFF §48). Everything in this document is arithmetic over
   constants; it deserves one confirmation from the running app before anyone
   spends a week on it. In the same run, register a one-storey tile as a spare id
   and photograph the tier seam. That single frame decides between (b2) and
   (b3)/(c).
2. **Then (b2), the one-storey close tile.** 2.2 MB against today's 2.8 MB — it
   *replaces* the near tier's bytes rather than adding to them — and it turns a
   0.16 m smear into a 37 x 23-texel window. Two to three sessions. Named risk:
   the H2 invariant, measured in step 1 rather than argued.
3. **Then storey bands as geometry**, scoped to the Drag first. ~13 MB for three
   districts, one bake script, the same shape as `bake_entrances.py`, and it
   gives the wall the horizontal rhythm no texture at this zoom can hold.
4. **Per-window geometry city-wide is a project, not a pass** — ~350,000
   features, ~165 MB, PMTiles and a new LOD budget. Worth wanting. Not worth
   starting this month.

**Sequencing note:** Y4 (raise `ZOOM_MAX` so you can look at your feet) pushes
`floor(zoom)` to 24–25 at walking height, where the repeat is 0.13 m. Whatever
lands here must be expressed as *metres of wall*, not as a zoom stop, or Y4 will
silently undo it. **Do this before Y4, or make Y4 re-run the check.**

---

## 6. THE ONE THING TO ASK SIMEON

Not "which option" — that is execution and it is mine. The taste question is:

> **How close is the Drag meant to survive?** Standing on the pavement opposite,
> looking at a shopfront 15–20 m away, do you want to read *windows* — heads,
> sills, panes, one lit at night — or is a wall with real storey lines and no
> windows enough? The first is (b2) plus geometry and it is weeks; the second is
> storey bands alone and it is days.

Show him the two side by side before he answers.

---

## 7. WHAT I DID NOT DO

* **Did not open a browser.** Another agent had it. Every zoom, repeat and
  metres-per-texel figure is derived from constants in `js/controls.js`
  (`ZOOM_MAX` 21.5, `ALT_MIN` 1.7, `PITCH_MAX` 88, `C`, `camPx`) and
  `js/facades.js` (`TIER_CSS` 32, `TILE` 64, `TIERS`, `GRIDS`, `WALL`), plus
  MapLibre's pattern scaling **as this repo measured it** rather than as I
  assumed it. Nothing here is a fresh instrument reading.
* **Did not confirm the repeat from pixels.** I measured stripe periods in
  `03-GUADALUPE-...png` (autocorrelation peak 36 px on the tan upper wall, 42 px
  on the dark wall right, and a separate ~9 px period on the modelled shopfront
  glazing, which is geometry and not the atlas). Those are *consistent* with a
  1–2 m repeat at a 15–25 m wall distance, but **the pose for shot 03 is not
  recorded anywhere I could find**, so I cannot convert screen pixels to metres
  without assuming the thing I am trying to prove. Step 1 of the recommendation
  exists for this reason.
* **Did not verify the 142-combo count in the app.** It is HANDOFF's measured
  284 images / 2 tiers, and it reconciles to the measured 2,840 KB to the byte,
  and I recomputed 58 of the 142 offline from `data/facade_palette.json`. I did
  not enumerate the other 84.
* **Did not measure `updateFacades` for any proposal.** The 80.4 ms baseline is
  quoted from HANDOFF (min of 5 interleaved reps, hardware GL, one page load
  each). (b2)'s repaint cost should be within noise of it — same texel count —
  but that is a prediction, not a measurement.
* **Did not build or prototype anything.** This pass was one document, by
  instruction.
* **Did not look at the night frame (04) in detail**, so nothing here is said
  about how the collapse interacts with the lit-pane scatter. At 0.13 m panes the
  night scatter is almost certainly a haze rather than windows, and that is worth
  a look when Y2 (the unlit street) is done.
