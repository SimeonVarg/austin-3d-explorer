# Why some West Campus blocks are black at night

QUEUE **W4**. Diagnosis only — this pass wrote this file and no code.
Acer lane, 2026-08-05, branch `acer/night-black-towers`.

---

## The one-paragraph answer

It is **not** a missing night colour, **not** an unstamped feature, **not** a
quantise miss, and **not** a different drawing system. Every West Campus wall
band has a pattern id, every id resolves to a registered atlas image at both mip
tiers, and the magenta mask puts the black slab squarely on `wc-wall`. The cause
is that **one facade family, `dk`, has no lit-window variant by design** —
`js/facades.js` says so in two places: `GRIDS.dk = null, // drawn as bands` and
`OCCUPANCY.dk = [0.00, 0.00], // parking decks have no glazing`. Exactly two
bands in the city use it, and one of them is **25.2 m tall and is 44 % of The
Castilian's elevation**. That is the whole slab.

The second half of the answer is that it is **not 3 and not 12 — it is 2
bands on 2 buildings**, plus 24 short crowns that are unlit on purpose. The
other dark masses in the same frames belong to `buildings-3d`, a different
layer and a different problem.

---

## 1. What the instrument was

| | |
|---|---|
| server | `python scripts/serve.py 8271` (not `http.server`) |
| page | `_harness.html?intro=0&drift=0`, 1440×900, `deviceScaleFactor 1` |
| hour | tod slider `p = 0.88`; `facadeAtlasHour()` confirmed `0.88` before every read |
| probe | `window.cancelGraphicsAutoDetect()` called at the top of every run |
| GL | **SwiftShader** — `chrome.mjs`'s default, which is the correct backend for pixel assertions and useless for timing |
| atlas reads | `map.style.imageManager.images[<wp><tier>].data` — the real RGBA the GPU samples. 64×64 near tier, 32×32 far. **This is measured BEFORE `map.setLight` multiplies it.** |
| screen reads | full-resolution PNG screenshots, i.e. **after** `js/graphics.js`'s CSS grade. Different buffer from `night-pale.mjs`, which reads the raw GL canvas |
| `harness-drift.mjs` | PASS (`index.html` 28 scripts, `_harness.html` 28 scripts) before any pixel work |

### The magenta-mask trap this pass hit, written down so the fixer does not

`#ff00ff` on a `fill-extrusion` at night **does not come back as `#ff00ff`.**
`map.setLight` multiplies it, so the mask pixels measure **≈ (124, 12, 159)**.
A `r>200 && g<90 && b>200` test finds **zero** pixels and reads as "the layer
draws nothing", which is exactly the wrong conclusion.

And the fix for that has its own trap: a hue-only test
(`g+8 < r && g+8 < b`) matches **47,811 pixels of the untouched night frame**
at the Castilian pose, because a night city is full of dim purple. The mask must
be `hue-purple(mask frame) AND changed-from-base`. Without the `changed` term
every number below is inflated ~3×.

---

## 2. Which bands are dead — the enumeration

84 wall bands over 23 buildings were read out of the live source with
`querySourceFeatures('austin-westcampus')` at z14.1 pitch 0, which is low enough
that every West Campus tile is loaded. (At z15.2 four buildings are outside the
tile set and TIER 4's authored bands are missing — if you re-run this, go to
z14.1 or you will under-count.) *The Venue on Guadalupe* sits outside even that
viewport; it is `sg`/`mh`/`sf` in the baked file, i.e. the ordinary lit stack.

**Every band's pattern id resolved to a registered image at both tiers.
`missing images: 0`.** Nothing is transparent, nothing is unstamped.

Measured per family, off the atlas images themselves. `warmHot%` is the share of
texels that are both bright (L ≥ 100) and warm (R > B + 12) — i.e. a lit window.
`pk/mean` is the tile's peak luma over its mean, which is what "does this facade
have anything bright on it" actually means:

| fam | ids | tile meanL | tile maxL | pk/mean | **warmHot %** | tile R:B | what it is |
|---|---|---|---|---|---|---|---|
| `tg` | 2 | 57.6 | 218.4 | 3.71 | 15.75 | 1.14 | curtain wall |
| `mh` | 14 | 62.6 | 209.2 | 3.33 | 9.37 | 1.16 | punched campus grid |
| `tr` | 5 | 65.8 | 208.2 | 3.18 | 12.87 | 1.17 | residential tower |
| `sb` | 2 | 66.9 | 163.1 | 2.44 | 8.05 | 1.10 | deep horizontal bands |
| `sg` | 3 | 83.7 | 142.6 | 1.70 | 32.38 | 1.08 | club/suite glazing |
| `sp` | 4 | 76.4 | 105.2 | 1.33 | 7.81 | 1.56 | arcade piers |
| `sn` | 3 | 57.4 | 104.7 | 1.83 | 3.13 | 1.34 | brick piers, open bays |
| **`dk`** | **1** | **42.2** | **86.3** | **2.04** | **0.00** | **0.99** | **parking deck** |
| **`sf`** | **9** | **53.0** | **68.2** | **1.22** | **0.00** | **0.96** | **board-formed crown** |

`dk` and `sf` are the only two families with **zero** warm-hot texels, and the
only two whose tile mean is **cool** (R:B < 1) while every lit family sits at
1.08–1.56. `dk37` is also the third-darkest tile in West Campus and the darkest
of any band taller than 5 m.

### Metres of elevation, by family

| fam | total m | **unlit m** |
|---|---|---|
| `tr` | 276.0 | 0.0 |
| `mh` | 255.6 | 0.0 |
| `sb` | 116.5 | 0.0 |
| **`sf`** | 82.3 | **82.3** |
| `tg` | 74.0 | 0.0 |
| `sg` | 74.0 | 0.0 |
| `sn` | 64.6 | 0.0 |
| `sp` | 54.8 | 5.4 |
| **`dk`** | 36.0 | **36.0** |

(Bay and step stacks double-count, deliberately — this is band elevation, not
building height.)

### The list

**A. The tall dead bands — this is the defect. Two of them.**

| building | band | wp | base → h | span | % of the building | maxL | warmHot % |
|---|---|---|---|---|---|---|---|
| **The Castilian** | `podium` | `dk37` | 4.6 → 29.8 m | **25.2 m** | **44 % of 57.0 m** | 86.3 | 0.00 |
| **Dobie Twenty21** | `podium` | `dk37` | 6.0 → 16.8 m | **10.8 m** | 14 % of 77.5 m | 86.3 | 0.00 |

**B. The short dead bands — unlit on purpose, and worth leaving alone.**

Every one of the 24 crowns is `sf` ("east grandstand back: board-formed
concrete, near solid"), 0.9–5.0 m tall, 82.3 m in total. `The Callaway House
Austin`'s 5.4 m `sp44` base is the one other zero. None of these makes a slab;
they make the top 2–5 m of a tower go quiet, which is what a parapet does.

**C. Everything else is lit.** All 5 `tr` towers, all 14 `mh` towers, both `tg`,
both `sb` (Cambridge Tower 42.8 m and Signature 1909 52.0 m — worth naming
because `sb`'s peak is 163 against `mh`'s 209, so they are the *dimmest* lit
towers and a future complaint may land on them).

---

## 3. Dead against lit, feature by feature, same building, same frame

Pose `castilian-close`: `center [-97.74237, 30.28738] zoom 17.9 pitch 72
bearing 25`, p 0.88, frame median luma **22.4**. Each row is a magenta mask on
`wc-wall` with the filter named, read back out of the *base* frame at exactly
that pixel set. Pairwise IoU between the podium and tower masks is **0.033**, so
these are genuinely different pixel sets and not one stale frame read four times.

| mask | px | mean rgb | luma | ×frame median | p95 | max | **R:B** | **lit ≥60 %** |
|---|---|---|---|---|---|---|---|---|
| Castilian **podium** `dk37` | 23,247 | (14.8, 14.2, 20.5) | **14.8** | **0.66×** | 32 | 105 | **0.72** | **0.18** |
| Castilian **tower** `mh46` | 30,840 | (26.7, 22.6, 30.9) | 24.1 | 1.08× | 55 | 116 | 0.86 | **4.11** |
| Castilian base `sp36` | 14,842 | (21.7, 19.4, 27.8) | 20.5 | 0.92× | 41 | 105 | 0.78 | 0.18 |
| Castilian crown `sf47` | 5,267 | (34.0, 24.4, 39.4) | 27.5 | 1.23× | 40 | 105 | 0.86 | 0.49 |
| **every other building's tower band** | 125,183 | (22.3, 20.1, 26.5) | 21.0 | 0.94× | 57 | 105 | 0.84 | **4.22** |
| `fam == dk` (both podiums) | 24,612 | (16.1, 15.3, 23.1) | 16.0 | 0.71× | 37 | 105 | 0.70 | 0.17 |

**The podium is 23× short of its own tower on lit pixels** (0.18 % against
4.11 %), and its tower is level with the 22 neighbours (4.11 vs 4.22). It is
also the only band in the frame **darker than the night sky around it** —
0.66× the frame median, so it reads as a hole rather than as a dark building.

### The same thing in the two frames the queue points at

Measured directly in the shipped PNGs, no browser involved:

| frame | region | luma | ×frame median | R:B | warm-lit % |
|---|---|---|---|---|---|
| `lobby-castilian-night.png` | the slab, x600–1500 y60–640 | 18.0 | 1.14× | **0.68** | **0.65** |
| `lobby-castilian-night.png` | lit neighbour, x160–460 y380–560 | 27.4 | 1.74× | **1.29** | **8.79** |
| `guadalupe-24th-night.png` | right block, x870–1480 y370–520 | 14.9 | 1.10× | **0.64** | **0.16** |
| `guadalupe-24th-night.png` | lit tower, x400–640 y130–320 | 21.3 | 1.56× | **0.80** | **4.28** |

The dead regions sit at R:B **0.64–0.68** and 0.16–0.65 % warm-lit; the lit ones
at 0.80–1.29 and 4.28–8.79 %. Those are the same two numbers the live masks
produced. **R:B below 0.75 with warm-lit under 1 % is the signature of this
defect** and is a cheap thing for a checker to assert.

The slab in `lobby-castilian-night.png` also has a **constant** ~23 px
horizontal band pitch from the top of the frame to the bottom, with no
perspective convergence — that is a tiling `fill-extrusion-pattern`, which the
`dk` branch draws at a 13 px pitch in a 64 px tile, not building geometry.

---

## 4. Every candidate, tested — not just the first one that fit

| candidate | verdict | the measurement that settles it |
|---|---|---|
| a missing or wrong `wn` night colour | **NO** | The Castilian podium `wn #1e1f25` = (30,31,37). Its own lit tower `wn #1f2026` = (31,32,38). **One unit per channel apart.** Dobie's podium is `#1e1f25` under a `tg` tower at `#12171f`, i.e. the *lit* band is the darker one. `wn` is not the variable. |
| a facade family with no lit variant | **YES — this is it** | `js/facades.js:246` `dk: null, // drawn as bands`; `js/facades.js:620` `dk: [0.00, 0.00], // parking decks have no glazing`. Measured: `warmHot% 0.00`, `maxL 86.3`, tile R:B 0.99. The `dk` branch's only night term is `DK_EDGE_NIGHT_TINT [190,210,235]` on a **1 px** deck edge at 0.85 alpha — a cool line, not a window. |
| a `band:"tower"` that never got a pattern | **NO** | 84 / 84 bands carry `wp`; `map.hasImage` says **0 missing** across both mip tiers. And the dead band is `band:"podium"`, not `"tower"` — anything filtering on `tower` will miss it. |
| a quantise step snapping to a bucket with no night entry | **NO** | `quantiseStadiumFacades` gives West Campus its **own** palette entries keyed by the baked `wd`, explicitly *not* the city's fourteen buckets, and pushes `{wd, wg, wn}` for each. 90 palette entries, 43 distinct West Campus ids, all registered. |
| drawn by a different system than its neighbours | **NO** | Magenta mask. `wc-wall` filtered to `name == 'The Castilian' AND band == 'podium'` turns exactly the black slab magenta (23,247 px, box x 405–944 y 227–502 at the pose above), and the lit mass directly above it is the same layer filtered to `band == 'tower'`. Same layer, same source, same paint expression. |

### The dark masses that are NOT this

At a wider night pose over West Campus (`center [-97.74430, 30.28960] zoom
16.35 pitch 72 bearing 335`), layer-level magenta masks attribute the frame:

| layer | px | luma | ×frame median | R:B | warm-lit % |
|---|---|---|---|---|---|
| `buildings-3d` | 153,591 | 23.4 | 1.03× | 0.87 | 3.77 |
| `wc-wall` | 92,740 | 19.9 | 0.88× | 0.81 | 3.07 |
| `drag-wall` | 3,607 | 33.6 | 1.49× | 0.97 | 16.11 |
| `outer-midrise`, `heroes-solid`, `moody-wall` | 0 | — | — | — | not in frame |

The large dark block at the bottom of that frame is **26.8 % `buildings-3d`**
and only 9.6 % `wc-wall` — a generic city extrusion, not West Campus. So there
is a second, separate population of dark night blocks in these frames, and it
is not W4's.

### Is this the same finding as PR #144?

**No, and it should not be filed as one.** PR #144's 188 were a **daytime**
problem: `data/outer_ring.geojson` features under 110 day wall luma, and the one
block anybody could actually see turned out to be Hyde Park Baptist Church
drawing from the downtown `TOWER_MIX` palette because `material_for` tested
height before class. One wrong palette pick, one building, day.

W4 is a **night** problem in a different file, with a different mechanism: a
family that is unlit by construction, on a band that is legitimately 25 m tall.
The only thing the two share is the phrase "a hole punched in the skyline" —
which is a description of the symptom, not of the cause.

---

## 5. Which file owns the fix

**`js/facades.js`.** Both halves of the cause live there:

- the `dk` branch of `drawTile()` (`js/facades.js:1304`), whose night behaviour
  is one 1 px cool edge line per 13 px band and nothing else;
- `OCCUPANCY.dk = [0.00, 0.00]` (`js/facades.js:620`) and `GRIDS.dk = null`
  (`js/facades.js:246`), which is what routes `dk` past the lit-pane code.

The taste handles are already parameterised and already named, which is why this
is a small fix: `DK_EDGE_NIGHT_TINT [190,210,235]`, `DK_EDGE_NIGHT_MIX 0.55`,
`DK_EDGE_NIGHT_BOOST 0.14`, and the band pitch of 13 px with a 7 px slot.

**Not `js/westcampus.js`.** It stamps the band, adds the layer and points it at
`window.FACADE_PATTERN_EXPR`. It carries no colour and no night logic. The one
night-adjacent decision it does make — `'fill-extrusion-vertical-gradient':
false` — is already correct and is documented against exactly this building
(`js/westcampus.js:946`: on The Castilian's 4.6 m ground floor the whole band
falls inside the gradient and renders black).

**Not `js/night.js`.** It owns streetlights and the ground; it does not touch
the facade atlas.

**`scripts/bake_westcampus.py` owns a second, separate question** — whether The
Castilian's levels 2–10 should be a 25.2 m open garage at all. The bake states
its source plainly (`"level 1 is retail, levels 2-10 are the parking garage,
level 11 is the amenity floor, 12-22 are rooms"`) and that is a real building,
so the geometry is probably right and the *tile* is what is wrong.

### What a faithful fix looks like, since it is not "give it windows"

A real 1960s open parking deck at night is **not** black. Every deck level is
lit — sodium or fluorescent — and you see it through the openings, which is why
a garage reads as a stack of glowing horizontal slots from across the street.
The current tile paints the slot at `mix(wall, [0,0,0], 0.55 + night*0.2)`, i.e.
**wall × 0.25 at full night**, across the 7 px of every 13 px band — 54 % of the
tile — and then brightens a single pixel. So 54 % of 25.2 m of The Castilian is
painted at a quarter of an already-dark wall.

The shape of the fix is a **cool interior glow in the slot**, not a warm pane
scatter: `DK_EDGE_NIGHT_TINT` already commits to garages being the one building
type lit cool, and that read is right. `OCCUPANCY.dk` should stay `[0, 0]` —
this is not a glazing problem and adding panes would make it a lie about the
building. Target, from the numbers above: bring the band from 0.66× the frame
median to roughly **1.0×**, keep R:B below 1.0 so it stays cool against the warm
residential towers beside it, and expect Dobie's 10.8 m podium to come along for
free since both bands share `dk37`.

---

## 6. How to reproduce every number here

1. `python scripts/serve.py 8271`
2. `node scripts/verify/harness-drift.mjs` — must PASS first.
3. Load `_harness.html?intro=0&drift=0`, 1440×900, call
   `window.cancelGraphicsAutoDetect()`, set the tod slider to `0.88` and call
   `window.applyTimeOfDay(map, 0.88)`.
4. **The band table**: `jumpTo` z14.1 pitch 0 over `[-97.7445, 30.2870]`, wait
   for `map.loaded()`, then `map.querySourceFeatures('austin-westcampus')` and
   keep `properties.kind === 'wall'`, deduped on
   `name|band|stack|base|h|fam`.
5. **The atlas table**: read
   `map.style.imageManager.images[wp].data.data` (RGBA, 64×64) for each distinct
   `wp`, and count `L ≥ 100 && R > B + 12`.
6. **The masks**: `map.setFilter('wc-wall', <filter>)`,
   `setPaintProperty('wc-wall','fill-extrusion-pattern', undefined)`,
   `setPaintProperty('wc-wall','fill-extrusion-color','#ff00ff')`, repaint, wait
   **≥ 2.5 s** on SwiftShader — at 1.1 s the previous frame comes back and every
   building measures the same, which is how this pass produced one page of
   nonsense before catching it — screenshot, restore, and mask with
   `hue-purple(mag) AND |mag − base| > 18`.

Also known and not chased here: `scripts/verify/westcampus-probe.mjs` is one of
the scripts in the page-setup regression — its `page.evaluate` block is gone and
it throws `d is not defined` before its first assertion, so none of its
`podium band exists (Castilian + Dobie)` checks currently run.
