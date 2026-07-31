# Night lighting pass — 2026-07-31

The complaint, verbatim: **"lights are a bit too dim on night mode."**

Scope: the whole scene's night look — windows, streets, ground, the warm/cool
balance across the city. **Not** DKR: the stadium's night lighting was being done
in a parallel session and `scripts/bake_stadium.py`, `data/stadium.geojson` and
the `stadium-*` layers were off limits here.

Read `docs/PASS_COMMON.md` first. This file is the reference table and the
failure ledger for the night pass specifically.

---

## 1. What was actually wrong, measured

Everything in this section is from `scripts/verify/night-luma.mjs`, on settled
frames at four poses. None of it is impression.

**Streetlights: a density problem, not a brightness one.** The layer generated
**1,039 lamps for the entire 3.3 × 3.1 km detailed bbox**. Where a lamp landed it
was strong (+34 to +37 luma), but it covered 0.4–1.7% of the frame and added
**+0.15 to +0.57 luma across the whole frame**. There were simply almost none of
them.

**The dark campus core had a specific, findable cause.** `road-probe.mjs` says
the basemap's `transportation` layer carries, in this bbox:

| class | features | had lamps before |
|---|---:|---|
| `service` | 246 | **no** |
| `path` | 170 | **no** |
| `secondary` | 154 | yes |
| `minor` | 112 | yes |
| `primary` | 67 | yes |
| `tertiary` | 56 | yes |
| `motorway` | 42 | yes |

`service` (campus drives and lot aisles) and `path` (Speedway, the East Mall,
every lit walk) are the two biggest classes after the numbered roads, and
**neither lamp tier claimed either of them**. Campus is almost entirely those two
classes. So campus — the middle of every frame — got no streetlights at all,
while West Campus, which sits on the city street grid, did. That is why the core
was the darkest part of the city.

**Lit windows were a rounding error next to unlit masonry.** With streetlights
hidden, warm-lit window pixels were **4.5% of the frame at the core pose and 2.8%
at the west pose**, with a median pane luma of 70–86. Meanwhile the *unlit* pale
limestone — the Co-op, the Texas Union, the Harry Ransom Center, University
Baptist — read as the brightest large masses in the Drag frame. That is the
inverted-silhouette failure this repo already knows about, showing up on
limestone rather than on a seating bowl.

**The city was uniform.** Lamp colour temperature measured R-B **27.3 at the
campus core and 27.5 at the western edge** — no gradient at all.

**The tone curve is NOT eating the night, and that matters because it was the
obvious suspect.** `graphics.js`'s filmic toe *lifts* night shadows rather than
crushing them: a raw 13/255 lands at 9/255 after the filmic blend against 3/255
for the straight linear grade. The post-process stack was left alone, as briefed.

**The real ceiling is auto-exposure, and it is a ceiling on the MEAN.**
`graphics.js` meters the raw frame open-loop and targets `AE.TARGET_NIGHT = 0.135`
with a log-space dead zone of `AE.KNEE = 0.16`. Past `0.135 × e^0.16 = 0.1585` the
gain starts coming *down*, to a floor of `AE.MIN = 0.85`, and quietly undoes
whatever was just added. The settled baseline sits at **0.132–0.136** — right on
the authored target. So "make night brighter" could not be a global lift; it had
to be local contrast: brighter, denser, *small* sources, with the frame mean kept
under 0.1585.

---

## 2. What changed

### `js/night.js` (owned by this pass)

| value | before | after | why |
|---|---|---|---|
| `WALK_CLASSES` | — | `service`, `path` | the dark campus core; see §1 |
| `WALK_SUBCLASS_SKIP` | — | `steps`, `platform` | not lit walks |
| `SPACING_MAJOR_M` | 62 | 46 | density |
| `SPACING_MINOR_M` | 88 | 64 | density |
| `SPACING_WALK_M` | — | 70 | see the ledger, §4 |
| `DEDUPE_GRID_M` | 32 | 28 | density |
| `POOL_OPACITY_MAJOR` | 0.52 | 0.66 | |
| `POOL_OPACITY_MINOR` | 0.36 | 0.50 | |
| `POOL_OPACITY_WALK` | — | 0.28 | a walk lamp is not a highway mast |
| `POOL_RADIUS` @ z13/15/17 | 2.5 / 6 / 16 | 2.8 / 7.5 / 19 | the mid ground went dark; z19.5 left at 44 because the near field was already the largest thing in frame and that end is the only real fill cost |
| `MINOR_RADIUS_SCALE` | 0.72 | 0.74 | |
| `WALK_RADIUS_SCALE` | — | 0.46 | |
| `CORE_OPACITY_BOOST` | — | 0.22 | the core keeps the emphasis |
| lamp colour | one warm pair | a core/edge pair per tier | §3 |

Lamp count: **1,039 → ~3,370** (541 major / 865 minor / 1,971 walk).

Two robustness fixes in the same file, both for bugs that cost real time here:

- **Generation failed silently.** MapLibre fires `idle` from inside its own
  render loop and an exception in a listener there does not reliably surface as
  a page error — it just leaves `_points` null with no log, which reads exactly
  like "the tiles were not resident yet". Generation is now wrapped and reports.
- **`idle` is not a reliable signal on this scene.** Measured: with the camera
  sitting still after boot, `idle` did not fire once in 28 seconds
  (`map.loaded()` stayed false throughout) and only arrived after a `jumpTo`. On
  a page nobody touches, that was a city with no streetlights for as long as the
  visitor left it alone. There is now a 6 s timer as a backstop; `generate` is
  idempotent so whichever fires first wins.

### `js/facades.js` — **taste block only**

This is the one shared file the brief allowed, and **only values inside the night
taste block changed**. No code path, no draw call, no tile, no image.

| value | before | after |
|---|---|---|
| `PANE_BRIGHT_MIN` | 0.40 | 0.58 |
| `HOT_PANE_RATE` | 0.05 | 0.07 |
| `OCCUPANCY.lo` | 0.14–0.40 | 0.22–0.46 |
| `OCCUPANCY.mr` | 0.13–0.42 | 0.25–0.54 |
| `OCCUPANCY.mh` | 0.12–0.40 | 0.24–0.52 |
| `OCCUPANCY.tr` | 0.16–0.46 | 0.28–0.58 |
| `OCCUPANCY.tg` | 0.08–0.34 | 0.20–0.46 |
| `OCCUPANCY.md` | 0.12–0.42 | 0.24–0.54 |
| `OCCUPANCY.tw` | 0.08–0.36 | 0.20–0.48 |
| `TONE_WARM_BIAS.mh` | 1.00 | 0.74 |
| `TONE_WARM_BIAS.tg` | 1.00 | 0.86 |

The occupancy roll is squared, so `E[occupancy] = lo + (hi−lo)/3` and the LOW end
is what most buildings actually get. Both ends moved by the same amount, so each
family's spread is unchanged and the typical building moves by the full step
while the liveliest towers barely notice — the complaint was about the ordinary
background city, not the highlights. The resulting means land at ~1.5–1.7× the
baseline, deliberately under the 2× that the file's own comment records as
having "washed the skyline" once before.

### Files NOT touched

`js/graphics.js`, `js/app.js`, `js/ground.js`, `index.html`, `_harness.html`,
`scripts/bake_stadium.py`, `data/stadium.geojson`, and every non-night code path
in `js/facades.js`.

---

## 3. Warm core, cool edges

Each lamp gets `w` (1 at the campus core … 0 past the fade radius), smoothstepped
on metric distance from `WARM_ANCHOR = [-97.7394, 30.2862]` (the Main Building),
full sodium inside 430 m and full cool LED beyond 1,250 m. The final colour is
**baked into the feature at generation time**, so the paint property is a plain
`['get','color']` — the same shape `signs-ground-glow` already uses — and there is
zero per-frame expression cost.

| | core (warm) | edge (cool) | luma |
|---|---|---|---|
| major | `#ffa63f` | `#9db4e6` | 177 / 179 |
| minor | `#ffbc6c` | `#b8c8ee` | 197 / 199 |
| walk | `#ffcf90` | `#ccd8f2` | 213 / 215 |
| lamp head | `#ffe6b4` | `#dde7f7` | 232 / 230 |

**The two ends are luma-matched on purpose** — see the ledger below.

**Provenance: GENERATIVE, not sourced.** Austin publishes no per-fixture
colour-temperature map and this is not derived from one. The *pattern* it leans on
is real — dense cores keep older high-pressure sodium and carry far more warm sign
and interior spill, while outer residential streets have been retrofitted to
~4000K LED — but the anchor, the two radii and every hex above are taste calls
about how a city reads from 400 m up.

The facade half of this (`TONE_WARM_BIAS` on `mh`/`tg`) is a **much weaker lever
and should be understood as an approximation**: the atlas is keyed by
(family × colour bucket) and carries no position at all, so it *cannot* do a
spatial gradient. It only works because the campus families happen to sit in the
core and the residential ones happen to sit in West Campus. The gradient that is
genuinely spatial is the streetlights'.

---

## 4. The failure ledger — what went wrong getting here

Written down because every one of these cost time and would cost it again.

**The measurement rig was wrong three times before it was right.** In order:

1. **Per-class masks built by hiding layers and diffing do not work on this
   scene.** Hiding ~30 fill-extrusion layers and showing them again re-tiles the
   scene and drops the facade atlas, and under headless swiftshader it does not
   come back inside any settle this suite can afford. Two consecutive lamps-on
   grabs of the *same* pose disagreed on **695,048 of 1,296,000 pixels**; the
   pale-masonry class read 11.4% of frame in one run and 2.0% in the next with
   identical code; and the streetlights — a layer whose colours are all warm —
   came back once as **11.6% of the frame in cool blue light**, because the diff
   was measuring load progress and calling it lamplight. `night-luma.mjs` now
   takes one `readPixels` per pose and changes no visibility at all.
2. **A luma-only "lit" threshold measures limestone, not windows.** At 60 luma it
   scored 38% of the visible building surface as lit windows; those were the
   Co-op and the Harry Ransom Center. Classify by chroma.
3. **…but a *warm* chroma threshold then mis-files cool light sources as walls.**
   Once the scene had 4000K lamps in it, a +25 R-B split put them in with the
   unlit masonry and made the west pose's "unlit" p99 leap 136 → 226 — which
   reads as exactly the inverted-silhouette failure and was in fact the new
   streetlights being counted as walls. The split belongs at **R-B = 0**: an
   unlit night surface reflects the night sky and is distinctly blue (measured
   mean rgb(57,61,81)), a cool LED is neutral-to-faintly-warm (rgb(51,48,45)).
4. And even at 0 it is not law. The scene legitimately contains cool light
   sources (TV-blue and fluorescent window tones), so **no** chroma threshold
   separates "a light" from "a wall" in general. The chroma classes are
   reporting; the assertions run on histogram *shape*.

**Two crashes, both from doing the reduction wrong.** Building a 1.3 M-entry JS
array per class to take a median closed the renderer outright
("Target page, context or browser has been closed"); so did holding four full
framebuffers across four poses in a single `page.evaluate`. Percentiles now come
from 256-bin histograms and there is one `evaluate` per pose. This is the same
family as the trap already in `scripts/verify/README.md` about handing a
framebuffer back through CDP.

**`python -m http.server` is single-threaded, and that alone made the scene never
finish loading.** `idle` never fired, `map.loaded()` stayed false, and the
streetlight layer therefore never generated — on the *baseline* build as well as
the changed one, which is the only reason it was not mis-diagnosed as a
regression. Use a `ThreadingHTTPServer`. (The README already says to serve on a
port nobody else is using; add this to it.)

**The cool edge came out brighter than the warm core.** Honest cool-LED hexes
(`#d8e2ff` and friends) are far lighter than the sodium they replace — `#ffa63f`
is luma 177, `#d8e2ff` is 226 — so "cooler edges" rendered as a belt of white
blobs across the West Campus foreground, out-punching the core they were meant to
defer to. The measurement said the same thing at the same time: the west pose's
frame p50 rose 10% while its p99/p50 contrast stayed flat. Luma-matching the two
ends fixed both. **A hue gradient must be a hue gradient.**

**The walk tier was 64% of all lamps at 54 m spacing** — every footway and
cycleway in West Campus, a carpet rather than a street grid. 70 m.

**`night-silhouette.mjs` is flaky at its own pose, and it is not this pass's
fault.** It locates the roofline with `queryRenderedFeatures`, which is the exact
call `scripts/verify/README.md` documents as returning 0 for fill-extrusion
layers at flying pitch. Measured over nine runs across both builds, it finds no
column about two thirds of the time. **When it does find one the answer is stable
and identical on both builds** (night: sky 38.3 vs wall 10.3, separation +28;
dusk: +48.6). A rewrite of it was attempted and reverted — measuring the skyline
as a *band median* rather than a wall pixel changes what the check claims, and
tuning band offsets until both times of day go green is fitting the test to the
answer. `night-luma.mjs` asserts the same claim robustly at four poses instead.

---

## 5. Verification

```bash
# Serve THIS worktree on its own port, threaded (see the ledger).
VERIFY_URL=http://127.0.0.1:8113 node scripts/verify/night-luma.mjs --lamps \
  --json night-after.json --baseline night-before.json
VERIFY_URL=http://127.0.0.1:8113 node scripts/verify/night-lights.mjs
VERIFY_URL=http://127.0.0.1:8113 node scripts/verify/night-silhouette.mjs
VERIFY_URL=http://127.0.0.1:8113 node scripts/verify/night-perf.mjs 5
VERIFY_URL=http://127.0.0.1:8113 node scripts/verify/shot.mjs night-after \
  scripts/verify/night-shots.json
```

`night-luma.mjs --baseline` is the guard the brief asked for: it A/Bs the luma
histogram and asserts the *shape* did not invert — the unlit mass may not be
lifted with the lights (p50 +≤8%), the sources must actually get brighter
(p99 up), the lights-to-mass contrast may not fall, and the frame mean must stay
under the auto-exposure ceiling.

`night-groundprobe.mjs` records where the night ground plane's value actually
comes from; it is what established that at p=0.92 the visible ground is the
golden→night preset lerp at 84% (#242121, luma 33.6) and *not* the `#090b12`
night preset, so aiming a fix at that field would have moved nothing.

---

## 6. Results

### Luma histogram, before → after (960×600, all poses settled, drift 0)

| pose | frame mean | p50 (unlit mass) | p90 | p99 (sources) | max | p99/p50 |
|---|---|---|---|---|---|---|
| core | .1339 → **.1420** | 30 → 31 | 51 → 55 | 115 → **122** | 217 → **249.5** | 3.83 → **3.94** |
| wide | .1317 → **.1418** | 31 → 32 | 46 → 53 | 111 → **125** | 218 → **249.5** | 3.58 → **3.91** |
| street | .1355 → **.1449** | 28 → 29 | 54 → 58 | 130 → **133** | 230 → **249.5** | 4.64 → 4.59 |
| west | .1344 → **.1431** | 30 → 31 | 50 → 54 | 111 → **123** | 217 → **249.5** | 3.70 → **3.97** |

This is the shape the brief demanded. The unlit mass moves **+1 luma** while the
light sources move **+7 to +14** and the peak **+32**. Every frame mean stays
under the 0.1585 auto-exposure ceiling, so none of it gets clawed back.

The one soft spot: the Drag pose's p99/p50 reads 4.64 → 4.59. That is p50
quantising from 28 to 29 in an integer histogram bin — one bin down there is
already 3.5% of the ratio — while p99 rose 130 → 133 and max rose 230 → 249.5.
The check carries 3% of slack for exactly this and says so.

### Streetlights and windows, isolated

| | before | after |
|---|---|---|
| lamps generated | 1,039 | **3,377** (541 major / 865 minor / 1,971 walk) |
| lamp pixels, core pose | 0.445% of frame | **1.609%** |
| lamp pixels, west pose | 1.656% | **3.812%** |
| luma the lamps add, core | +0.152 frame-wide | **+0.594** |
| luma the lamps add, west | +0.568 | **+1.565** |
| lamplight warmth, core (R-B) | 27.3 | 26.5 |
| lamplight warmth, west (R-B) | 27.5 | **8.0** |
| windows alone, core pose | 4.546% of frame, p50 70 | **6.338%, p50 83** |
| windows alone, west pose | 2.78% of frame, p50 86 | **4.101%, p50 94** |

Window-lit area is up ~40–48% with a brighter median pane, measured with the
streetlights hidden so the facade change cannot take credit for the lamp change.
The warm/cool gradient went from a 0.2 difference to **18.5**.

### Frame cost — none measurable

Interleaved, order-rotated, **minimum of the reps**, headed at 2560×1400, with
the anti-throttling flags from the README. Three configurations differing *only*
in feature count on the same layer with the same paint expressions — `off`,
`old 1027` (the baseline density, subsampled from the same generated points), and
`new full`:

| run | off | old 1027 | new full |
|---|---|---|---|
| A, min dropped | 124 | 129 | **127** |
| B, min dropped | 136 | 139 | **133** |

Spreads (run B): off `[205, 206, 202, 136, 151]`, old `[193, 207, 160, 139, 141]`,
new `[191, 210, 209, 133, 152]`. They overlap completely, and in both runs
`new full` lands at or below `old 1027`. **Adding 2,338 lamps has no measurable
frame cost** — circle fill is not what this scene is bound by.

Note how far the machine drifted inside a single run (8 fps early, 26 fps late).
That is precisely why the minimum is the statistic and a mean would have been
fiction.

The facade change adds **no** per-frame cost by construction: it moves pixel
values inside the existing atlas tiles and adds no image, no tile and no draw
call.

---

## 7. Honestly still missing

- **The pale unlit limestone is still the brightest large surface in the Drag
  frame.** The Co-op, the Texas Union, the Harry Ransom Center and University
  Baptist read as bright grey masses at night. The lit city has caught up with
  them — that is what the p99 and window numbers above are — but the underlying
  cause is the baked `wn` night wall colour for those buildings, which lives in
  `scripts/bake_detail.py` and `js/facades.js`'s non-night paths. Both were out
  of scope. **This is the highest-value next fix for night.**
- **Nothing spatial in the facade atlas.** The warm-core gradient is carried
  entirely by the streetlights. A building's lit-window temperature cannot vary
  with position while the atlas is keyed by (family × colour bucket).
- **`night-silhouette.mjs` is still a coin flip** at its own pose (§4). It was
  left as committed rather than rewritten into something that claims less.
- **No real-world reference for the colour temperatures.** §3 is taste.
- **Not measured on the actual Acer.** The perf A/B says the change is free on
  this machine; the scene's *baseline* cost — 8–26 fps at 2560×1400 — is the
  thing making the site feel laggy, and none of it is night-specific.
- **The lamp fence is the buildings bbox.** Streets outside it stay dark, which
  is correct for the outer ring but means the frame edge can go abruptly black at
  a wide zoom looking outward.
