# Real slopes: the roofs, the arches and the dome are surfaces now

*Branch `acer/slopes`. September 4, 2026.*

Every pitched roof on campus, every arched doorway, Sutton Hall's arcade,
Gregory Gym's gabled hall and the Capitol's dome used to be **flat pieces
stacked up to imitate a curve**. A dome was 75 discs. An arch was five straight
chords. A hip roof was a staircase of slabs. From far away that reads fine.
From anywhere near it, it reads as exactly what it is.

This pass draws them as the shapes they were always sampling from — real angled
geometry, generated from the same baked data, on a three.js layer that sits on
top of the same city. Nothing was deleted. The old flat pieces are hidden by
filter while the new geometry draws, and they come straight back the moment you
switch it off.

---

## Look at it

### The Capitol dome

`shots/slopes/capitol-dome-crop-before.jpg` → `shots/slopes/capitol-dome-crop-after.jpg`

This is the one to look at first. Before, it is nakedly a wedding cake: 75 flat
discs, a visibly stepped silhouette, a ledge ring where the cap meets the drum,
and a lantern sitting on a spike. After, it is a lathed shell with a real
shading gradient, standing on a two-tier drum with an open colonnade of
freestanding columns, its entablature, an upper windowed tier and a balustrade —
and the dome springs flush off that balustrade instead of stepping in from it.
The wings and the four corner pavilions got real hips at the same time.

Whole frames: `shots/slopes/capitol-dome-before.jpg` → `shots/slopes/capitol-dome-after.jpg`

### Sutton Hall's arcade

`shots/slopes/sutton-arcade-before.jpg` → `shots/slopes/sutton-arcade-after.jpg`

Before: a flat wall with one lone arched door and some square windows. After: a
continuous run of round-headed arches with the stone carried between the bays
and a string course over the crowns. `data/campus_truth.json` had said "4 round
arches at grade (1 door, 3 windows), the arcade continuing round the west"
since the truth pass, and nothing drew it. The bay pitch is derived, not
invented: the narrowest a bay can be is the opening plus its two bands plus a
pier (2.60 + 0.90 + 0.50 = 4.00 m), snapped so the wall's second arched door
lands on the grid — Sutton's are 27.86 m apart, so 7 bays of 3.981 m, 15 bays
across the 62.3 m wall, two of them the doors.

Whole frames: `shots/slopes/battle-street-before.jpg` → `shots/slopes/battle-street-after.jpg`

### Gregory Gym's front doors — chords against a curve

`shots/slopes/gregory-door-before.jpg` → `shots/slopes/gregory-door-after.jpg`

Magnified 20×, so you can see the individual pixels. In the BEFORE, the centre
arch's head has a flat plateau across the top with a hard corner where one
chord ends and the next begins — that is `ARCH_TIERS = 5`
(`scripts/bake_entrances.py:789`), which cuts every arch head into five flat
pieces, three times over (the fanlight glass, the stone band, the terracotta
spandrel fill). In the AFTER the plateau is gone, the archivolt is one
continuous curve, and the terracotta spandrel wedges shrink to what a real
spandrel is. The red slab band that was standing in for the pediment is a real
pediment with a raked cornice.

Whole frames: `shots/slopes/gregory-before.jpg` → `shots/slopes/gregory-after.jpg`

Across campus: 24 entrances are arched, and between them they carried **509
chord-and-cap features, 448 of which existed purely because the arc was five
flat pieces instead of a curve.** Gregory Gym alone: 30 of its 36 door features
were chords.

### The Main Mall, over the whole campus

`shots/slopes/mall-cruise-before.jpg` → `shots/slopes/mall-cruise-after.jpg`

Ten of the twelve roofs in that frame now read as ridge / hips / eaves rather
than as a bevelled lid.

---

## The fair fight: our Main Mall against Google's

`shots/slopes/mainmall-google.jpg` (Google Earth 3D, © Google / Maxar
Technologies — a screenshot used here for comparison only)
`shots/slopes/mainmall-ours.jpg` (ours, same camera)

This was run as a blind, matched-camera comparison, six rounds of critique on
the render plus four rounds of getting the two cameras to actually agree. The
critic was asked one question and only one: **does each roof read as ridge,
hips and eaves, or as a lid, a staircase, or mush?**

### Getting the cameras to agree — four rounds

Our pose never moved: centre `[-97.7393, 30.2856]`, zoom 17.48 (corrected for
this app's real 58° vertical field of view, `js/controls.js:52`), pitch 55,
bearing 0, 1440×900. Only Google's camera distance moved.

| Round | Google `dist` | What the round found |
|---|---|---|
| 1–2 | 600 m | The formula's own baseline. Ours read smaller than Google's. |
| 3 | 470 m | Better than 600 by eye, but the round said plainly its own pixel measurements were too noisy between two different renderers to trust a number. |
| 4 | **550 m** | Matched the camera *first*, re-derived `dist` from the formula (600.29 m), then bracketed 470/600. 550 is the closest of the four. |

Round 4 finally got a real residual, by measuring the **same architectural
feature in both renders** instead of measuring where each renderer happens to
draw an occluding rooftop. The Tower's open observation-deck colonnade — four
dark window slits under the roof cap, sharp in both a flat-shaded low-poly
render and a photogrammetry mesh — spans 28 px in Google's frame against 26 px
in ours: a 2 px, ~7% difference. A second independent feature (roof cap down to
the setback ledge) gives 188 px vs 194 px, 3% off, same direction. The roof
cap's top lands on the *identical pixel row* in both. Horizontally the labels
match to 1–5 px on a 1100 px frame. Google's own in-app readback confirms the
camera landed where asked: 317 m above ground against a predicted 315.5 m,
0.5% off.

**What did not work, and is worth remembering:** a first attempt measured full
Tower height down to where each render's own foreground rooftop occludes the
shaft and got a spurious ~30% gap. The two renderers simply model the roofline
in front of the Tower at different heights. Only shared, identifiable
architecture is a valid cross-renderer ruler; an occlusion boundary is not.

### Each round's gap, and the fix

| Round | What the critic said was wrong | What was done |
|---|---|---|
| 1 | Gregory's hall is a flat block; Sutton is a flat wall with one arched door; the dome is "a tall pointed ogive, taller than it is wide, with nothing on top" | The hall became a gable to its pediment; Sutton got its arcade; the dome got a real lathe profile with the lantern standing ON its crown, and the wings got roofs |
| 2 | Gregory's hall still doesn't read as a gable; the drum has a visible ledge ring where cap meets drum | The hall's two planes take the city's own roof shading; the drum was rebuilt in tiers with the dome springing flush off the balustrade |
| 3 | The monitor on Gregory's ridge is "a flat-topped tan rectangular block"; the ridge has no line | The shader's definition of "sloped" sat at 11.5°, and the monitor is a real gable at 10°, so it was being lit as a flat lid. `SLOPES.slopedMinDeg` is 6 now. The ridge got a stone cap line. |
| 4 | Roofs stop in a deck instead of running to a ridge; the Main Building is three staircases | Every roof the photograph reads as tile now runs to its ridge (104 of 115); the Main Building's three roofs are hips |
| 5 | "Welch Hall: one giant flat brown lid with a wide orange tile band running round the whole perimeter — a shape the building does not have" | A roof is pitched to a ridge, or it is flat. A flat roof draws no band and no plate; its tiled parts are hips of their own. The Main Building's eave became a shadow line rather than a fake overhang. |
| 6 | "Almost every red roof reads as a flat plateau with a bevelled rim (a truncated pyramid), not two slopes meeting at a ridge" | The measurement: from this camera a far slope projects to `0.574·w − 0.819·rise`, so Garrison's north slope is **2.8 m of a 12.2 m half-span — 4 px against the near slope's 60** — and nothing marked the ridge. Google's frame marks it, because a real barrel-tile roof carries **ridge and hip courses**: round tiles bedded in mortar, standing proud, reading from the air as pale lines about 1.5× the field's luma. Those courses are generated now, from the rig alone. 1,780 of them. |

### The verdict, in the critic's own words

> *"On the only axis asked — does each roof read as ridge/hips/eaves or as a
> lid/staircase/mush — B is unambiguous on roughly ten of twelve roofs (Main
> Building south block and both tower wings, Texas Union, Sutton, Calhoun,
> Garrison, Mezes, Welch all show a ridge and hip lines meeting cleanly;
> Flawn, NHB/Hackerman and Will C. Hogg are drawn flat), and its eaves show as
> a thin light lip proud of the wall. A's roofs are all topologically correct
> but the geometry is soft: hips and eaves melt into walls at Sutton's east
> end, the Main Building's north wings around the tower base, Flawn's bowed
> corners and Goldsmith's rim, and trees eat into wall edges, so the
> roof-to-wall separation the question asks about is carried by tile colour,
> not by shape. B's errors are two real shape errors, A's are pervasive
> softness. Crisp and mostly correct beats soft and correct here."*

B is ours. **Ours won.**

The critic also named the one thing to fix on the winner, and it is not fixed
here: **Goldsmith Hall's courtyard is drawn as a solid dark plane at roof
height inside a red bevelled rim**, so it reads as a lid. It should be four
hipped wings around an open courtyard, with the inner ring as a hole. That is
logged as a follow-up below.

And on the loser, for the record: the biggest legibility gap in Google's frame
is the Main Building's north wings and the base of the Tower, where the roofs
read as mush with no ridge or eave and the west wing's hip dissolves into a
tree. That is the region our frame is crispest in.

---

## The numbers, each with the conditions it was measured under

### Frame time — it costs essentially nothing

Headed Chrome with `--disable-gpu-vsync --disable-frame-rate-limit`, the real
`index.html` (never `_harness.html`), **ON and OFF interleaved inside ONE page
load** by flipping `window.SLOPES.on` with the camera never moving, 200 frames
per rep, 3 reps, the **minimum of the three medians** reported. Graphics preset
`balanced`, `window.cancelGraphicsAutoDetect()` called twice at the top, served
by `scripts/serve.py` on 8801. Machine quiet at launch (CPU 1%, 9.35 GB free,
zero other headless Chrome). Hardware GL: ANGLE / NVIDIA GeForce RTX 3050 Ti
Laptop GPU / Direct3D11.

| Pose | OFF | ON | Δ | Draw calls | Triangles in frame |
|---|---|---|---|---|---|
| mall-cruise | 8.30 ms | 8.30 ms | **+0.00 ms** | 3 | 50,223 |
| gregory | 6.40 ms | 6.40 ms | **+0.00 ms** | 2 | 49,799 |
| battle-street | 7.20 ms | 7.40 ms | **+0.20 ms** | 7 | 61,121 |
| capitol-dome | 6.50 ms | 6.70 ms | **+0.20 ms** | 6 | 59,777 |

Worst case **+0.20 ms** on a 16.7 ms frame budget. The day before, on a less
quiet machine, the worst pose was +0.70 ms; gregory measured +0.70 ms that day
and 0.00 ms this one. **Take the range, not either number** — this is exactly
the variance `scripts/verify/README.md` warns about, which is why the rule here
is minimum-of-interleaved-reps and never a single reading.

**The SwiftShader floor, stated so nobody quotes the hardware number out of
context.** On the software backend a single frame of this city costs
**500–616 ms** with the layer switched off (mall-cruise 616 ms, gregory 500 ms,
battle-street 533 ms, capitol-dome 500 ms — measured on `main` at e232953, same
four poses). That is two orders of magnitude past the hardware numbers above.
Software rendering is not a usable surface for a claim like this, so the timing
claim above is a hardware claim and only a hardware claim.

### The off state is `main`, to the pixel

`?slopes=0` on the branch against `git archive e232953` served on its own port,
tolerance **0**, auto-exposure pinned off on every page, graphics auto-detect
cancelled, screenshot twice and keep the second, hardware GL, 1440×900:

**mall-cruise 0 px. gregory 0 px. battle-street 0 px. capitol-dome 0 px.**
Zero of 1,296,000 pixels at every pose, max channel delta 0, with zero console
and page errors across all three pages.

The harness's own noise floor was measured beside it as a control — a *second*
load of the same `?slopes=0` page, A against A′ — and came back 0 / 0 / 0 / 12
px at max delta 1. **The flake landed in the control pair, not in the
measurement.** The branch-against-archive comparison is a true zero, not a zero
within tolerance.

Probes confirm the comparison is not vacuous: on the `?slopes=0` page
`window.slopes` is an object but `getLayer('slopes-mesh')` is false; on the
archive page `window.slopes` is undefined entirely.

Evidence: `final2/identity/identity4.json`, `final2/logs/identity4.log` (in the
session scratchpad; per the disk rule only cited frames are committed).

### The gates

All four green on hardware, served by `scripts/serve.py`.

1. **`scripts/verify/slopes-layer.mjs --against`** — **51 of 51 passed, 0 failed.**
   The bake-identity line reports 0 of 1,296,000 px at max delta 0. The
   toggle round-trip is 980 px at max delta 12, inside the documented facade
   atlas two-state residue (ceiling 1200 px, delta ≤ 16). The
   runtime-off-vs-`?slopes=0` ratchet is 5,210 px against its named 7,000
   ceiling. The control that keeps those honest shows **225,295 px change**
   when `SLOPES.on` goes false — so the layer really is drawing.
2. **The same script with `--break`** — **39 of 51, i.e. exactly 12 red**, and
   they are exactly the documented set: stack (1), fog/haze (2), one-fetch (1),
   arches (6), flat-roofs (1), courses (1). **The gate can be watched failing.**
3. **`walkmeter.mjs`** — PASS. Self-check drift 0, 0 route errors, UI gate
   passes (the avoid-stairs checkbox turns routing on and back off via a real
   mouse click). Two pairs are unmeasurable on metric A because their
   ground-truth door has no anchor in `data/walk_graph.json` — a pre-existing
   data gap recorded in `docs/walk-baseline.md` §2, not this branch.
4. **`facadegrid.mjs`** — 0 failing assertions.

`VERIFY_MAX_MS=2400000` was raised so neither `slopes-layer.mjs` run could be
killed mid-gate by its own watchdog.

### Geometry

**61,545 triangles** in the layer overall:

| Group | Triangles |
|---|---|
| `slopes-roofs` | 31,484 |
| `slopes-arches` | 18,315 |
| `slopes-dome` | 11,322 |
| `slopes-tower` | 424 |

115 roofs are built (104 run to their ridge; 8 are flat, drawn as 11 parts),
plus 1 gable, plus 1,780 ridge/hip/valley courses. 24 arches. 2 to 7 draw calls
per pose.

### Page bytes — and the honest bit

Cold, hardware, CDP `Network.loadingFinished.encodedDataLength` (bytes actually
on the wire; a cache hit counts 0), with a **fresh browser launch per
configuration**. That last part matters: a new Playwright context does *not*
give a new HTTP cache, and running both configurations in one browser had
previously counted a 56 KB file as free.

- ON page: **19,571,125 B (18.664 MB)** over 136 main-thread responses.
- `?slopes=0`: **19,571,091 B (18.664 MB)** over 133.
- **Delta: 34 bytes** — response-header noise on the `index.html` URL, which
  differs only by the query string.

`data/entrances.geojson` is fetched **exactly once**, 6,736,473 B. It used to be
fetched twice, for 13,157 KB, and fixing that is what took this branch's page
cost to zero. The cause was worth writing down: MapLibre 5.24.0 does not store
what you hand a GeoJSON source, it wraps it, so the "reuse the parsed object"
path was silently reading `undefined` and falling back to a second network fetch
on every single load.

**The delta is ~0 for a reason you should know about.** `?slopes=0` still
downloads all of it:

| File | Bytes on the wire |
|---|---|
| `three.min.js` (r159, from unpkg) | 166,482 B (162.6 KiB) |
| `js/slopes.js` | 58,373 B |
| `js/slopes-roofs.js` | 71,400 B |
| `js/slopes-arches.js` | 22,157 B |
| `js/slopes-dome.js` | 18,853 B |
| **total** | **337,265 B (329.4 KiB)** |

That 329.4 KiB is this pass's real cost over `main`, and it is paid on both
pages. See "the switch is a rendering switch, not a byte switch" below.

**One instrument trap resolved rather than reported.**
`data/capitol_dome.geojson` shows as 0 wire bytes on the ON page and absent on
OFF, which reads like a 56,422 B regression and is not:
`js/capitol.js:568` adds that file as a MapLibre GeoJSON source on **both**
`main` and the branch, so MapLibre fetches it inside its worker where a
page-scoped CDP session cannot see it — the exact 19 MB trap
`scripts/verify/README.md` documents — and the dome generator's own main-thread
fetch is a cache hit. Confirmed by two independent instruments: CDP's
`fromDiskCache`, and the Resource Timing API's `transferSize` /
`encodedBodySize`.

---

## The switch

One line, two ways in:

```
?slopes=0                 # at load: the layer is never built
window.SLOPES.on = false  # from the console: stops on the next frame, no reload
```

`SLOPES.on` is an accessor read live in `render()`, never cached, so flipping it
from the console takes effect immediately and puts every hidden fill-extrusion
stand-in back.

**Be clear about what the flag does: it is a rendering switch, not a byte
switch.** `?slopes=0` still downloads three.js and all four slopes scripts —
329.4 KiB of them (table above) — because the `<script>` tags in `index.html`
are unconditional. The flag buys back the *build*, not the *bytes*. Gating those
tags on the flag is a listed follow-up.

---

## The taste constants

Rule 11: every aesthetic call is a named constant you can overrule with a
one-line edit. These are the ones worth knowing, with their shipped defaults.

**`window.SLOPES`** (`js/slopes.js`)

| Constant | Default | What it does |
|---|---|---|
| `facetShade` | `{ on: true, ambient: 0.35, lo: 0.70, hi: 1.28, tilt: 38 }` | Lights a real sloped face the way `js/timeofday.js` paints a flat slab: the same two ends, the same painted 38° tilt. **The critic chose contrast.** With it off, a mesh roof is lit honestly by the real light on the real 22.6° pitch — and at golden hour Gregory's two planes came out 8 luma apart, which read as one flat orange plate to three blind critics. With it on, a mesh roof and the slabs beside it are one look at every hour. The four numbers must stay in sync with `ROOF_SHADE` in `js/timeofday.js` and `SHADE_LO`/`SHADE_HI` in `scripts/bake_roofs.py`. |
| `roofShade` | `1.0` | A multiplier on the lit colour of every sloped face. `1.0` is bit-exact (x × 1.0 == x). Set it to **0.78** and a sunlit slope lands back on the old slab's tone (measured at Gregory, morning: 175,77,43 as a mesh, 136,60,31 as slabs). Below 0.78 darker, above 1.0 brighter. |
| `slopedMinDeg` | `6` | How far off vertical a face's normal must be to count as "sloped". It used to be an unnamed 0.98 in the shader — 11.5° — and Gregory's clerestory monitor is a real gable at 10°, so it fell under the line and was lit as a flat lid. Nothing on campus is pitched between 6° and 11.5° except that monitor. |
| `byPreset` | `{ performance: 0.5, balanced: 1.0, cinematic: 1.0, ultra: 1.0 }` | Geometry density per graphics preset — lathe and arch segment counts. |
| `verticalGradient` | `1` | Applies MapLibre's own base-darkening curve to mesh *walls* only. |

**`window.SLOPES_ROOFS`** (`js/slopes-roofs.js`)

| Constant | Default | What it does |
|---|---|---|
| `lines.on` | `true` | The ridge / hip / valley courses. This is round 6's whole answer. |
| `lines.ridge` | `{ w: 1.0, h: 0.15 }` | Metres: how wide the ridge course is and how proud of the ridge it stands. A real ridge course is ~0.4 m wide, which at mall-cruise (0.74 m/px, foreshortened by 0.574) is **half a pixel** and would draw as a broken dash. 1.0 m is about one pixel of top face plus the lit side. Same reasoning as `bake_tower.py` drawing the clock dial at 3.05 m rather than its true 3.66 m. |
| `lines.hip` | `{ w: 0.8, h: 0.15 }` | Same, for hips. |
| `lines.valley` | `{ on: true, w: 0.5, tone: 0.82 }` | A valley is flashing, not tile — so it is *darker* and lies flush. `on: false` leaves the crease bare. |
| `lines.pale` | `0.38` (day/golden), `paleNight` `0.08` | How far the course colour moves from the roof colour toward white. **If the courses ever read too bright, this is the number.** |
| `lines.minM` / `straightDeg` | `0.4` / `8` | A top edge shorter than 0.4 m is a point, not a ridge; a corner turning less than 8° is a sample point on a wall, not a hip. |
| `ridgeCap` | `{ w: 1.0, h: 0.12, colour: 'stone', tone: 1.0 }` | The ridge line on Gregory's hall. At 0.86 of the roof colour it landed between the two planes' tones and vanished. |
| `monitorPitch` | `0.18` | Gregory's clerestory monitor: a low gable. |
| `capShade` | `{ on: true, tone: 0.62, layer: 'buildings-roof' }` | The parapet cap under a mesh roof, painted as wall standing in the eave's shadow. `on: false` leaves it terracotta. |
| `eaveBand` | `{ on: true, tone: 0.62, depth: 1.0, proud: 0.10 }` | The same shadow as geometry where there is no cap to paint — the Main Building's attic loggia. |
| `fullHip` / `flatRoofs` | `true` / `true` | Rounds 4 and 5. `fullHip: false` is round 3's plates. |
| `corbelBand` | `{ down: 0.64, up: 0.05, proud: 0.20 }` | The continuous stone band a corbel table stands on, so 26 blocks read as one raked line from the air. |

**`window.SLOPES_ARCHES`** (`js/slopes-arches.js`)

| Constant | Default | What it does |
|---|---|---|
| `segments` | `24` | Points per quarter-curve, × the preset's detail. |
| `smooth` | `true` | The curved pieces shade as one curve, not a necklace of facets. Corners stay sharp. |
| `radial` | `true` | The extrados grows on both axes — a real archivolt. `false` steps outward in one axis only, as the chords did. |
| `arcade` | `true` | Sutton's arcade. |
| `arcadeString` / `arcadeStringProud` | `true` / `0.06` | The string course over the crowns, and how far proud of the skin it stands. |
| `arcadeSpandrel` | `'band'` | On an arcaded wall the spandrels take the surround's stone; the critics read the family's terracotta wedges as a texture defect there. `'own'` puts the accent back. |
| `transom` / `band` / `spandrel` | all `true` | The three pieces of an arch head. |

**`scripts/bake_capitol.py`** — the dome's own numbers.

| Constant | Default | What it does |
|---|---|---|
| `LATHE_CROWN` | `0.42` | Crown radius over springing radius — the lantern's 3.1 m on the dome's 12.6 m. |
| `LATHE_POWER` | `2.5` | Superellipse exponent; 2 would be a plain ellipse. |
| `LATHE_SWELL` / `LATHE_SWELL_M` | `0.03` / `1.5` | The widest ring stands 3% of R outside the springing, 1.5 m above it. |
| `LATHE_SAMPLES` | `36` | Profile points, springing to crown. |
| `DRUM_BASE_R/H/WINDOWS` | `1.00` / `5.3 m` / `16` | The windowed base ring. |
| `DRUM_PERI_*` | wall `0.82`, columns `0.89`, half-column `0.6 m`, height `7.2 m` | The peristyle of freestanding columns and the wall behind them. |
| `DRUM_ENT_R/H` | `0.98` / `1.1 m` | The entablature, overhanging the columns. |
| `DRUM_UPPER_R/H` | `0.74` / `3.2 m` | The upper tier with the arched openings. |
| `DRUM_BAL_R/H` | `0.87` / `1.2 m` | The balustrade — and the dome's springing radius. |
| `CAP_HIP_PITCH` | `0.30` (16.7°) | The Capitol wings' low metal hip. |
| `CAP_PAVILION_M2` | `(200, 700)` | A part this big at h=32 is a corner pavilion. |

**Say this plainly: the dome's and drum's proportions are named constants read
off the reference frame, not survey numbers.** Every `DRUM_*` and `LATHE_*`
value above was measured in *pixels on a photograph* and converted — the
comments in `scripts/bake_capitol.py` say things like "42 px of 160, leaned up".
They are a faithful reading of one image, not a measured elevation. If someone
ever gets real drawings of the Capitol drum, these are the numbers to replace.

---

## What was NOT fixed, and why

1. **Recessed arches.** Gregory's arches sit in a bay that projects 2.9 m in
   the footprint; the recess itself is a 5 cm dark panel. **This renderer
   cannot cut a hole in a fill-extrusion wall.** A colour is the depth, as on
   every entrance in this city. Same for Sutton's loggia recess.
2. **The Capitol's north pediment, and the wings' window rows.** A pediment
   there would be an authored elevation like Gregory's — new content with no
   measurement behind it. The window pitch belongs to the facades bake, not to
   a slope. Both are the owner's call, not the renderer's.
3. **The pitch stays 22.6°** (bake `PITCH` 0.42, a 5:12 style default). The
   critic asked for 25–30° "so the slopes are tall enough to shade distinctly",
   but the shading is the slabs' own painted 38° rule and does not depend on
   the pitch — and from this camera a *steeper* roof makes the far slope
   **thinner**, not taller (`0.574·w − 0.819·rise`: Garrison's north slope is
   2.8 m at 22.6°, 2.2 m at 25.5°, 1.2 m at 30°). The read the critic wanted
   came from the courses instead. The only measured pitch on campus is the Main
   Building's 25.5°, off two photographs.
4. **The Tower crown is left as measured.** Ours has both setbacks the critic
   asked for (shaft 1.0 → clock stage 0.86 → belfry 0.49 of the shaft, from
   `bake_tower.py`'s rectified-elevation numbers) and the colonnade. At
   0.74 m/px the 0.29 m gaps between belfry columns are sub-pixel, so it reads
   as a box with slits; Google's rounded cap is photogrammetry smoothing a
   stepped cap. **Redrawing a measured building to match a blob is the wrong
   trade.**
5. **The Main Building's own entrance is not arched in the data.** Fourteen
   buildings carry an `arches` entry in `data/entrances.geojson`; MAI is not one
   of them, so nothing curves there. That belongs to
   `scripts/bake_entrances.py`, not to the renderer.
6. **Sutton's centre-door keystone fragment.** Roughly **2 native pixels** of
   terracotta spandrel still show above the crown of the centre fanlight, at
   14× magnification. The equivalent crop of the same spot with the layer off
   carries far larger red wedges, so this is a shrunken remnant of the
   stand-in, not a regression. Cosmetic, and named rather than hidden.
7. **Aliased edges are the map's, not the layer's.** `js/app.js` creates the
   WebGL context with `antialias: !!window.GFX_MSAA`, which only the `ultra`
   preset sets, so every fill-extrusion edge in the city is aliased at the
   default preset too. A custom layer drawing into that context cannot
   antialias its own edges alone — which is part of why the 1 px courses are
   drawn as wide as they are.

---

## Follow-ups

1. **Goldsmith Hall's courtyard is a solid lid at roof height.** The critic's
   one named fix on the winning frame. It needs the footprint's inner ring as a
   hole so the courtyard drops to ground level, four wings each with its own
   ridge, hips at the outer corners and valleys at the inner ones.
2. **Four real roofs are on the mesh but not in the slabs.** Re-running
   `scripts/bake_roofs.py` with the wing survey on finds tiled wings on Calhoun
   Hall, Jackson Geological Sciences, Gearing Hall and Gordon-White that the
   shipped 2026-08-22 bake did not. They draw on the mesh. Whether the slab city
   should also gain them is a call for the roofs lane.
3. **The bake still emits folded deck rings.** `js/slopes-roofs.js` untangles
   them at runtime before triangulating (`ROOFS.untangleDeck`, `deckMinM2`),
   because earcut fed a self-crossing ring produces triangles outside it. The
   renderer is doing the bake's job; `scripts/bake_roofs.py` should not write a
   ring that crosses itself.
4. **Drop the old slabs and get their bytes back.** The `rig` member costs
   102,221 B raw / 22,244 B brotli on top of `roofs.geojson`, and the 4,066
   slab, course, rake and voussoir features it replaces are still shipped
   because `?slopes=0` needs them. If the flag is ever retired, so are they.
5. **A head height from `scripts/bake_entrances.py`.** `ARCHES.cappedFams` is a
   hardcoded list of families whose arch may not grow past its own entablature
   (family B's architrave + frieze + cornice, `cornice=0.30`). The bake knows
   the number and does not write it. **That list goes away the day it arrives.**
6. **Gate the script tags on the flag.** `?slopes=0` should not download
   329.4 KiB it will never execute.
7. **Vendor three.js with SRI.** It is loaded from
   `https://unpkg.com/three@0.159.0/build/three.min.js` with no integrity hash,
   which is a third-party dependency on the critical path of a public site.
   `vendor/tesseract/` is the pattern this repo already uses for exactly this.
   Note r159 is the last release that ships a plain-script build — r160 removed
   `three.min.js` — so a newer pin means switching to an ES module.

---

## Where the pieces are

| | |
|---|---|
| The layer | `js/slopes.js` (three.js custom layer, the shared shader, the switch) |
| The generators | `js/slopes-roofs.js`, `js/slopes-arches.js`, `js/slopes-dome.js` |
| The data | `data/roofs.geojson` (`rig`), `data/entrances.geojson` (`arches`), `data/capitol_dome.geojson` (`lathe`, `drum`, `rig`), `data/tower.geojson` |
| The bakes | `scripts/bake_roofs.py`, `scripts/bake_entrances.py`, `scripts/bake_capitol.py` — all three are augments: without `--rebake` they regenerate every output, compare it to what is on disk, and stop at exit 2 writing nothing if anything differs |
| The gate | `scripts/verify/slopes-layer.mjs` (`--against` for bake identity, `--break` to watch it fail) |
| The full history | `HANDOFF.md` §203–§215 |
