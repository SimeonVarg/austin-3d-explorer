# Night rendering — code inventory (current `main` c656249)

Written in the `acer/night-package` worktree; no code was changed to produce it.
Written 2026-09-19 for the Codex night-renderer plan. Line numbers are against c656249.
`LANES` is the session's local scratch folder; the captures it names are local and git-ignored
(`austin-reference-images/_night/_baseline-c656249/`), not in this repo.
Sections 1-4 are READ FROM CODE. Section 5 is MEASURED (captures, pixels, timing).
Section 6 is the defect list (each item says which evidence it rests on). Section 7 is PROPOSED.

**Summary for the planner (details and evidence below).** Night is not a renderer; it is dozens of
separate colour ramps and five kinds of ground disc, run on nine different clocks, and every
light in it (except the DKR stadium mesh) is multiplied by a blue moonlight because neither
renderer has an emissive term. Only two lights in the city have a modelled source: the UT
Tower floods and the DKR gantries.
Measured consequences: blue hour and twilight render the city brighter than its sky (lake luma
161 vs sky 31); lit windows land khaki/lavender and never reach bloom's threshold (<=0.001% of
pixels above luma 200 at night, every view); at walking height the window atlas collapses to
all-lit or all-dark buildings; street light is a flat orange floor on the carriageway (luma
~150) with black pavements (~14), placed on road centrelines (2.2% within 15 m of a mapped
pole) and absent from downtown entirely (the lamp fence stops at lat 30.269). Night costs no
measurable frame time (desktop and `?lite=1`, both views; spreads overlap, night's minimum is
never meaningfully above day's); a retint to night costs 1.0-3.2 s of main thread.

---------------------------------------------------------------------------------------------------

## 1. The clock: one slider, nine schedules

`p` is the slider (0 day, 0.5 golden, 1 night; `index.html:89`, step 0.01, default
`TOD_DEFAULT_P = 0.50` `js/timeofday.js:29`). The sun is a piecewise-linear track in p
(`js/sky.js:49-56`): p .50 -> +6°, .60 -> -4°, 1.00 -> -40°. So:

| p    | sun elev | sky/civil state                          |
|------|----------|------------------------------------------|
| 0.54 | +2°      | LAMP_ON (street lamps start)             |
| 0.56 | 0°       | sunset                                   |
| 0.60 | -4°      | start of blue hour                       |
| 0.62 | -5.8°    | end of civil twilight = "blue hour" pick |
| 0.689| -12°     | end of nautical twilight = "twilight" pick (owner's 20:36 photos, ~61 min after a 19:35 sunset) |
| 0.756| -18°     | end of astronomical twilight             |
| 0.90 | -31°     | `skyBodies().night` reaches 1            |
| 1.00 | -40°     | "full night" pick (owner's 03:05 photos) |

Capture positions used below: **0.62 blue hour, 0.69 twilight, 1.00 full night**.

Only ONE subsystem is on the sun-elevation clock that `js/sky.js:119-173` (SKY_TUNE.DUSK)
says everything should use. The others each carry their own ramp in p:

| Consumer | Ramp | file:line |
|---|---|---|
| Street-lamp pools/heads, tower pool, entrance pools | `skyBodies(p).lamps`: smoothstep sun +2° -> -6° (p .54 -> .622) | `js/sky.js:253`, `js/night.js:740-742`, entrances pool uses the same |
| Sky darkness, AE target, OSM-label dim | `skyBodies(p).night`: linear sun +1° -> -31° (p .55 -> .90) | `js/sky.js:249`, `js/graphics.js:837`, `js/timeofday.js:468` |
| Stars | smoothstep sun -7° -> -18° | `js/sky.js:257` |
| Facade-atlas lit windows (city, outer towers, WC fill-extrusion, places, drag, moody) | `night=(p-.55)/.45`, pane mix `min(1,night*1.3)` -> full at p≈.90 | `js/facades.js:1969`, `:2158`; `js/places.js:325`; `js/drag.js:579`; `js/moody.js:523` |
| Facade-atlas WALL darkening | `max(night, -sunElev/9)` (sun-driven) | `js/facades.js:1971-1976` |
| Hero + arts window scatters, DKR field | `(p-.62)/.38` -> 0 until p .62 | `js/heroes.js:458`, `js/arts.js:241`, `js/app.js:1183` |
| Prop walk lamps (OSM `street_lamp` points) | `(p-.58)/.27` (the OLD lamp ramp that sky.js calls wrong) | `js/props.js:109`, `:494-498` |
| Every baked `wd/wg/wn` trio: roofs, outer ring, crowns, retail bands, Capitol, WC solids, campus storeys, entrances glass, stadium seats | linear golden->night over p .5 -> 1.0 | `js/timeofday.js:208-215`, `js/outer.js:315-326`, `js/westcampus.js:147-165`, `js/facades.js:3368-3376` |
| three.js slopes layer (apartments, roofs, arches, dome, art) `cNight` vertex colour | linear golden->night over p .5 -> 1.0, in the vertex shader | `js/slopes.js:360-361` |
| DKR mesh floodlight mask | smoothstep p .58 -> .92 | `js/slopes-stadium.js:22`, `:362` |
| Sign text brand colour / sign pools | text: p .55 -> 1 linear; pools: preset lerp `signGlow` 0 / .42 (at golden, sun +6°) / 1 | `js/signs.js:153-171`, `js/timeofday.js:59,70,101` |
| Citywide sunlight + glass reflection fade-out | smoothstep sun 0° -> -6° | `js/slopes.js:196`, `:1076-1077`; `js/timeofday.js:191-202` |

(The evaluated table for 12 values of p is in section 5.2.)

## 2. Every night colour / emissive path, by renderer

There is NO general emissive term in either renderer. Every "light" is one of:
(a) a baked colour that is brighter at night, pushed through the same lighting multiply as
everything else; (b) a ground-plane `circle` layer with alpha; (c) a symbol (text) colour;
(d) a DOM/canvas overlay (sky, stars, bloom).
The single exception is the DKR stadium mesh: its patch `lit = mix(lit, max(lit, cNight *
aStadiumLight), ...)` runs AFTER the `* u_lightcolor` multiply (`js/slopes-stadium.js:361-362`
vs `js/slopes.js:398-399`), so its floodlit members are the one de-facto emissive in the repo
and are not tinted by the blue night light. That patch is the working precedent for a `cEmit`
path in the three.js layer.

### 2.1 Global light, grade and post (applies to everything)

- **Night map light**: `lightColor '#8fa0e0'`, `lightIntensity 0.04` (`js/timeofday.js:81`).
  Direction comes from the SUN, not the moon (`js/timeofday.js:409-420`): at p=1 the sun is at
  -40°, so the light points up from below the ground (evaluated position z = -0.803, §5.2).
  MapLibre's extrusion shader and the slopes shader (`js/slopes.js:392-404`, transcribing
  MapLibre at `:316-319`) both compute `colour * directional * u_lightcolor`: every lit window,
  lamp-lit sign band and floodlit wall (DKR mesh excepted) is multiplied channel-by-channel by
  (0.561, 0.627, 0.878).
  Two files know this and pre-divide their night hexes by it — but by the OLD light `#9aa6da`
  (`js/tower.js:322,447,531-542`; `js/entrances.js:51,603`), which no longer matches `#8fa0e0`
  (R 0.93x, G 0.96x, B 1.03x of what they were calibrated against). Nobody else compensates.
- **Hour grade** (`js/timeofday.js:73-103` via `js/graphics.js:849-873`): night exposure 0.95,
  contrast 1.08, saturation 0.88, vignette 0.38 (blue-black `[3,6,20]` a .74,
  `js/graphics.js:882-888`), filmic tone LUT 0.65 (`js/graphics.js:701-709`, toe floor 0.010).
- **Auto-exposure** (balanced+): meters the raw GL frame, target 0.135 at night, gain clamp
  0.85-1.20, ±17% dead zone (`js/graphics.js:794-846`). Open loop, EMA 900 ms.
- **Bloom** (`js/graphics.js:1034-1068`): the GL canvas is drawn into a 256-px-wide canvas with
  `brightness(thr) contrast(4) blur()`, `thr = 0.50-0.04*bloom` (`:1055`). At balanced
  (bloom 0.40) only raw values above 0.375/0.484 = **0.775 (luma ~198)** survive, then added
  back at alpha 0.31 (`:1065`). It is resolution-independent of the windows (a 1-2 px pane is
  averaged away at 256 px wide).
- **God rays / flare**: only when the sun disc is live (`js/graphics.js:1007`); off at night.
- **Depth fog** `aerial-fog` (`js/sky.js:419-468`, `:556-561`): night DIST 2100 m, MAX 0.46,
  colour = mix(horizon `#2c3a63`, zenith `#040713`, 0.22). A real lerp, so distant lit windows
  are pulled toward dark blue.
- **Sky overlay** (DOM/canvas, `js/sky.js`): night zenith `#040713`, horizon `#2c3a63`
  (`js/timeofday.js:145-159`), 520 stars (`js/sky.js:1245-1256`), moon disc + halo
  (`:62-66`, `:1453-1480`), a warm skyglow band scaled by `night` with alphas 0.014-0.052
  (`:1519-1521`).
- **Shadows**: none below the horizon (`js/shadows.js:50-51,85-86`); no moon shadows.

### 2.2 MapLibre fill-extrusion with a facade PATTERN (the atlas)

Layers: `buildings-3d`, `parts-3d`, `outer-tower`, `outer-midrise`, `wc-wall`, `drag-wall`,
`arts-panel`, `moody-wall`, `heroes-*`, `places-glass` (the atlases of arts/heroes/drag/moody/
places are their own painters, same shape). All go through the city-lighting shader patch
(`js/city-lighting.js:192-223`), which at night is a no-op: `cityShade()` returns the original
colour when `u_sunPresence.x <= 0` (`js/city-lighting.js:61`).

`js/facades.js` — the atlas painter for city buildings, outer towers (`tg`, 10 baked buckets,
`js/facades.js:3295-3298`, `data/outer_tower_palette.json`) and the downtown streetwall (`mh`,
6 buckets):
- Tile: one 64-unit square repeat, `REPEAT_M` 32.98 m of wall at the reference zoom
  (`:244-246`), grid per family `GRIDS` (`:416-427`): lo 2x3, mr 6x5, mh 8x5, tr 9x5, tg 10x7.
  The grid is re-derived at the camera's tile zoom (metre anchor, `:245`, `:477-491`,
  `:2975-2980`, up to z22): the repeat halves per zoom level, so rows/cols fall to 1x1 near the
  ground (§5.4).
- Lit choice (`:2126-2160`): `seed = bucketIdx*4 + famIdx + measIdx*331` (`:2085`);
  building occupancy = `lo + (hi-lo)*roll²` with `roll = hash01(seed+4001,0,0)` from
  `OCCUPANCY` (`:1003-1012`, e.g. tg 0.20-0.46, tr 0.28-0.58, dk 0); then PER PANE
  `isLit = night>0.05 && hash01(seed,r,c) < occupancy` (`:2148-2149`).
  Tone per pane from `WINDOW_TONES` (40% incandescent, 30% warm LED, 18% neutral, 9% office
  fluorescent, 3% TV blue; `:951-957`) compressed by `TONE_WARM_BIAS` (`:1024`); brightness per
  pane 0.58-1.0 biased bright (`:971-972`); 7% "hot" panes pushed 35% to white (`:973-974`).
  Deterministic hash, no flicker (`:1722-1726`).
- Unlit glass at night -> `mix(glass,[12,15,28],0.9)` (`:1985-1987`).
- Parking decks `dk`: no glazing; deck-edge strip turns cool-fluorescent `[190,210,235]`
  (`:1025-1029`, `:2029-2045`).
- Stadium family `st`: continuous concourse ribbon + portals (`:787-839`).
- DKR per-elevation tiles (`sp/sb/sn/sf/sg/sd`, `:1744-1935`): concourse ribbons, club levels
  lit as a room, one hash scatter in `sb`.
- Walls at night come from the baked `wn` (`scripts/bake_detail.py:night_wall()`, `:1091-1098`).

Other atlas painters (same mechanism, own ramps and constants):
`js/heroes.js` (stoneLit .52, brickLit .34, nbLit .28, glassLit .40, cageGlassLit .30 —
`:157-207`; the per-pane roll is `hash01(col+const, row+const)` `:509,553,589,616,640` — no
building or floor term, so the scatter repeats with the tile), `js/arts.js` (glassLit .42, panel wash `:79-102`, `:241-320`),
`js/drag.js` (PCL_NIGHT_LIT .34, RET_NIGHT_LIT .26 `:112,166`), `js/moody.js` (concourse
ribbon, health-body 30% scatter `:117-160`, `:303`), `js/places.js` (133 storefronts: one
continuous warm ribbon, NIGHT .86, tone `[255,190,94]` `:189,196,345-379` — every shop lit,
all night), `js/tower.js` own band atlas (`:645-711`).

### 2.3 MapLibre fill-extrusion with baked colour trios (no windows)

- Roof caps `buildings-roof`, `parts-roof` -> `rn`; pitched slabs `roofs-pitched` -> `rn`
  (`js/timeofday.js:426-430`).
- Outer ring (`js/outer.js:315-326`): 6,866 low-rise prisms are FLAT colour (no windows at any
  hour); 335 crowns (`k='c'`), 751 ground-floor retail bands (`k='r'`), 309 plaza pads (`k='g'`)
  take their baked `wn` (section 5.4 measures them).
- West Campus solids (`js/westcampus.js:99-145`): pool `#1d4a63` ("lit from inside"), Moontower
  sign `#ff8a3c`, The Standard sign `#cdd6e4`, jumbotron `#7f97b8`; decks/rails dark. Tier-four
  wall night ramp `gain .19, tint [18,22,40] toward .42` (`:535-583`) — also used by
  `js/slopes-apartments.js:488-493` for the meshes.
- Capitol (`js/capitol.js:64-121,168-200,545-563`): floodlight = a flat override
  (`floodWall '#d38e5e'`, `roofNight '#372d21'`, dome collar `#5d4430`), no falloff.
- Stadium legacy extrusions (`js/app.js:895-905` SEAT_COL, `:1182-1197` field, `:1361-1372`).
- Campus storey trim courses (`js/facades.js:3366-3420`) — trim only, no windows.
- Entrance glass (`js/entrances.js:516-537`): the bake's `wn`, pre-compensated for `#9aa6da`.

### 2.4 three.js custom layer `slopes-mesh` (`js/slopes.js`)

One scene drawn inside MapLibre's frame. Vertex attributes `cDay/cGold/cNight` lerped by `u_p`
in the vertex shader (`:360-361`), then MapLibre's light formula including `u_lightcolor`
(`:392-404`, light synced from the evaluated map light `:966-999`), then `cityShade()` (day
only). No emissive attribute. Consumers:
- `js/slopes-apartments.js` — authored apartments. `nightLit 0.45`, ONE lit tone
  `nightLitTone '#d9b46a'` for every lit pane in every building (`:125-129`). Lit choice
  `h01(key,'lit',fi,ci,pi) < 0.45` per window (`:943`; mod-4 skin `:1193`), key =
  building|block|face|skin (`:1730`, `:2107`), `fi` = band-local floor index. Storefront /
  curtain stacks are `lit: true` unconditionally (`:1110-1116`); openings lit only when flagged
  (`:1347`, `:1359`). The lit pane is `[pane_day, pane_golden, '#d9b46a']` (`:740`), so it
  reaches its lit colour only at p=1.
- `js/slopes-roofs.js` (`paleNight .08` `:307`), `js/slopes-dome.js` (Capitol dome, CAPITOL
  night overrides `:102-110,208-222`), `js/slopes-arches.js`, `js/slopes-art.js`.
- `js/slopes-stadium.js` (Acer-owned DKR mesh; READ ONLY here): per-vertex floodlight mask
  `aStadiumLight` (field/paint/light members 1.0, seats 0.92 -> 0.62 with height) blended
  `max(lit, cNight*mask)` on its own p .58-.92 smoothstep (`:22`, `:354-376`), applied after
  the light-colour multiply (see the exception above). The light gantries exist as geometry
  (`'light'` members: west press-box gantry `:322-333`, goal-post light members `:262-264`),
  so the DKR is the second place in the repo whose light has a modelled source. `js/stadium.js`
  (Mac lane) is not on main at c656249; the stadium extrusions' night colours are in
  `js/app.js:895-905,1182-1197,1361-1372`.
- `js/tower.js` (UT Tower) — the ONLY sourced lighting model in the repo: 292 floods in four
  setback circuits, seven named configurations, `?towerlight=`, numeral windows, clock dials
  pre-divided by the night light (`:248-549`, `relightNight` `:1355-1460`).

### 2.5 Ground-plane light (`circle` layers, `circle-pitch-alignment: map`, blur ~1)

| Layer | Points | Size / alpha | Source of the point | file:line |
|---|---|---|---|---|
| `night-streetlight-pool` + `-core` | 3,344 generated (535 major / 839 minor / 1,970 walk) | pool 8-18 m ground radius x1.5, peak alpha .17-.41; head capped 3.6 m | sampled every 46/64/70 m along basemap road CENTRELINES, deduped on a 28 m grid, fenced to the buildings bbox +150 m | `js/night.js:46-296`, `:601-715` |
| `night-tower-pool-fill` | 1 | 115 m radius, `#ff9c42`, .30 | the Tower shaft | `js/night.js:337-347` |
| `props-lit` + `-core` | 236 (193 OSM `highway=street_lamp`, 43 blue phones) | 7-9 m near, alpha .42/.85 | OSM mapped lamps (`data/props.geojson` k=lit) | `js/props.js:73-109`, `:333-358` |
| `entrances-pool` | one per door (1,413 door features) | 7-11 m, .30/.16 | every entrance, lit or not | `js/entrances.js:208-221` |
| `signs-ground-glow` | 48 signs | brand colour, alpha `.2*signGlow` | sign anchor = building point | `js/signs.js:86-104` |

Layer order (measured from `getStyle()`, §5.4): the street pools (#137-138) and entrance pools
(#127) sit BELOW `ground-paths` (#145, a raised fill-extrusion), so they light the carriageway
and are hidden under every raised pavement; `props-lit` (#153) was moved above the ground stack
(`js/night.js:414-440` documents the gate that blocks moving the street pools).

`data/walk_lamps.json` (193 warm + 43 blue, OSM) is read ONLY by `js/wayfind.js:440,4849`
(routing), and republished from the props bake; it does not drive any renderer directly.

### 2.6 Symbols

`signs-label` (`js/signs.js:110-135`): 48 curated names (9 hero, 39 secondary), screen-space
text, cream by day, brand colour at night with a growing blurred halo — the only "neon" in the
city, and it is not on a facade. OSM building labels dim 45% at night (`js/timeofday.js:466-472`).
Entrance inscriptions / channel-letter wordmarks go `#ffe2b4` at night (`js/entrances.js:323-328`).

### 2.7 Ground, water, trees, sky palettes at night

`js/timeofday.js:73-103`: ground `#090b12`, park `#0b120e`, road `#2a2519`, casing `#0b0d13`,
water `#070f1e`, canopy `#1e3a24/#162a1a`. `js/ground.js:656-670`: limestone `#1b1e28`,
asphalt `#0d1017`, water `#070f1e`, brick paving `#2a2019`; texture fades (`:1467-1501`),
lane markings fade 50% (`:917-918`). No reflections in water (none exist in code), no wet-street
specular, no light-spill term on any ground surface other than the circles above.

## 3. How lit windows are chosen — structure audit

| Renderer | Unit of choice | Randomness | Architectural structure present? |
|---|---|---|---|
| facade atlas (`js/facades.js:2126-2160`) | one pane cell of a 33 m tile | `hash01(seed,r,c) < occupancy`, independent per cell; seed = (family, colour bucket[, measured grid]) | NONE. No floor, unit, room, core, lobby or crown. The same scatter is shared by every building with the same (family, bucket) and repeats every tile (33 m at the reference zoom) both vertically and horizontally — e.g. a `tr` tower repeats its lit pattern every 9 storeys, `tg` every 10. Tone and brightness are also per pane, so one "apartment" mixes incandescent, fluorescent and TV-blue panes at random. Occupancy is constant from dusk to 03:00. |
| hero / arts / drag / moody atlases | slot / bay cell of their own tile | `hash01(col+k, row+k2)` with constant salts (`js/heroes.js:509,553,589,616,640`; `js/arts.js:271,314`) | per-tile, same shape as above; no floor logic |
| places storefronts (`js/places.js:345-379`) | the whole shopfront | none: every one of 133 shops is a continuous lit ribbon | structure yes (a shop is a room), but no open/closed state, no per-business hours, all equally bright |
| three.js apartments (`js/slopes-apartments.js:943,1193`) | one window opening | `h01(building|block|face|skin,'lit',bandFloorIdx,col,part) < 0.45` | real floor lines and bays exist (the geometry has them), but the lit choice ignores units: paired openings of one room (`offsets`) and the two faces of a corner unit roll independently; every building has exactly the same 45% share; one tone `#d9b46a` for every lit pane in the district; storefront/curtain stacks are 100% lit (`:1110-1116`); `fi` is band-local so two bands of one skin on one face repeat the same vertical pattern |
| UT Tower (`js/tower.js:337-549,1355-1460`) | floodlight circuit per setback + numeral windows | none (sourced configuration) | YES — the only sourced model |
| DKR mesh (`js/slopes-stadium.js:354-376`) | per-vertex mask | none | partly: falloff with seat height; lights on every night |

## 4. Light sources vs light — audit

Lights with no plausible source (a pool or glow with no fixture that could make it):
- `night-streetlight-*` — 3,344 synthetic points sampled along road CENTRELINES
  (`js/night.js:569-586,622-670`): no pole, no arm, no head at height; the "head" is a second
  ground disc (`:483-495`). They are not placed at mapped lamps (§5.5 measures the overlap).
- `signs-ground-glow` — 48 brand-coloured pools at each sign's anchor point
  (`js/signs.js:86-104`); the sign itself is screen-space text, not a lit object on a facade.
- `entrances-pool` — a pool per door LEAF for all 1,413 door features, whether the door has a
  light or not (`js/entrances.js:1200-1216`). All 1,413 door features are 5-point closed
  POLYGON rings (counted in `data/entrances.geojson`), and MapLibre 5.24.0's
  `CircleBucket.addFeature` emits one circle per point of every ring (read in the
  `maplibre-gl-dev.js` 5.24.0 build the page loads, lines 26209-26214). So each leaf draws a
  pool at each of its 4 corners (5 if the closing point survives geojson-vt tiling — not
  checked), ~5,650-7,065 pools in all. Arithmetic, not pixel-measured: stacked alpha at the
  leaf ≈ 1-(1-0.30)^4..5 = 0.76-0.83 for main doors (authored 0.30), 0.50-0.58 for others
  (authored 0.16).
- WC pool water `#1d4a63` and The Standard jumbotron `#7f97b8` "glow" but light nothing
  (`js/westcampus.js:102-145`).
- The Capitol floodlight is a flat wall colour with no fixture positions and no falloff; its
  lawn and approach are not lit (`js/capitol.js:64-121`).
- Window light spills onto nothing (no balcony, soffit, pavement, tree or neighbour gets any).

Sources with no light:
- 531 prop "lamp" poles (OSM street lamps, masts; `data/props.geojson` k=lamp,
  `js/props.js` `props-lamp` fill-extrusion) are dark geometry; their only light is a ground
  pool at the base (`props-lit`), and that runs on the stale p .58-.85 ramp.
- Downtown: 751 ground-floor retail bands and 335 crowns render at their baked `wn`
  (§5.4: darker than the walls above them). Austin's lit crowns and street retail are absent.
- 6,866 outer-ring low-rise prisms have no windows at all (`js/outer.js:285-293`).
- Parking decks (`dk`, occupancy 0) get a thin cool edge line and nothing inside; no lit deck
  ceilings, no spill (`js/facades.js:1025-1029,2029-2045`).
- Rooftop amenity levels / penthouses: no lit crown mode anywhere; tops use the same scatter.
- Signs mounted on buildings (Moontower, The Standard) are baked colours that get multiplied
  by the blue night light like everything else.
- No traffic, no traffic signals, no aircraft-obstruction lights, no car headlights.
- Stadium floods: on every night regardless of events (taste/data question, Mac/DKR lane).

---------------------------------------------------------------------------------------------------

## 5. MEASURED

### 5.0 How, and what to distrust

- Server: `python scripts/serve.py 8661` on the worktree (main c656249). Browser: headless Chrome,
  **hardware GL** (ANGLE, RTX 3050 Ti Laptop GPU per the perf run's renderer string), via
  `LANES/gpu-run.mjs`, 1440x900 at dsf 1, `index.html?intro=0&drift=0&clip=1`,
  `cancelGraphicsAutoDetect()` right after style load, wait for `slopesApartments.readyToReveal()`.
  Preset = the default `balanced` (bloom 0.40, god rays 0.5, auto-exposure ON, filmic 0.65,
  exposure 1.03). Per shot: pose, `applyTimeOfDay(p, force)`, idle (cap 30 s), re-pose, 3 s,
  screenshot, 1 s, screenshot again (second kept, JPEG q86). Stats are computed on the JPEG (post
  CSS grade, i.e. what a viewer sees). Scripts: `LANES/night/code/night-capture.mjs`,
  `night-sweep-core.mjs`, `night-perf-ab.mjs`, `lamp_audit.py`.
- **The machine was loaded** by other lanes' browsers the whole time (all 3 GPU slots busy; CPU
  88% at the start of the perf run). Boot took 87-344 s.
- **The authored-apartment handoff timed out in 4 of 5 boots.** `js/app.js:1945-1950` switches
  `APARTMENTS.on=false` for the visit if the three.js apartments are not ready 90 s after boot
  (`INTRO.authoredCeilingMs`, `:1793`). Under this load that fired every time except the first
  test boot (87 s). Run A and run B therefore show West Campus as LEGACY prisms with the blurred
  atlas; run C, the sweep and the perf runs re-enabled `APARTMENTS.on` in-page and waited for the
  group before shooting (logged `APARTMENTS before {"on":false} group after re-enable true`).
  **Use run C as the primary evidence**; run B is the legacy-fallback state (what a slow machine
  gets), and is the source for view 10 (run C's garage pose landed inside a building).
- Auto-exposure is an EMA across shots; a frame's gain depends on the previous frame. Every
  shot logs the gain (`capture-report.json`). Two sweep "split" rows at the campus aerial are
  contaminated by it (see 5.3).
- `queryRenderedFeatures` probes at eye level mostly return ground layers even where a wall is
  on screen; used only to confirm the water plane.

### 5.1 Captures (paths)

Primary: `LANES/night/code/captures-C/` — `NN-view-pPPP.jpg`, PPP = 062 (blue hour, sun -5.8°),
069 (twilight, sun -12.1°, the owner's 20:36 photos), 100 (full night, sun -40°);
`sheet-C-01.jpg` (views 01-04), `sheet-C-05.jpg` (05-08), `sheet-C-09.jpg` (09-12) are 3-hour
contact sheets. `capture-report.json` has every pose, AE gain, filter string and frame stat.

| # | view | pose (eye lng,lat,alt m -> target) | run |
|---|---|---|---|
| 01 | downtown skyline across Lady Bird Lake (eye on the water, south of the Congress bridge) | -97.7465,30.2612,10 -> -97.7430,30.2690,80 | C |
| 02 | Congress Ave street level at ~5th, looking at the Capitol | -97.74285,30.26790,1.7 -> -97.74060,30.27450,30 | C |
| 03 | West Campus elevated, down onto ION / 21st & Nueces (same subjects as the owner's elevated series) | -97.7428,30.2866,75 -> -97.7433,30.2844,10 | C |
| 04 | West Campus elevated, NW over Rio Grande (same subjects as the owner's elevated series) | -97.7437,30.2850,70 -> -97.7462,30.2895,40 | C |
| 05 | West Campus street, Rio Grande at 23rd, eye level | -97.74478,30.28660,1.7 -> -97.74455,30.28950,10 | C |
| 06 | South Mall looking north at the Tower, eye level | -97.73940,30.28400,1.7 -> -97.73932,30.28625,60 | C |
| 07 | Main Building terrace looking south down the South Mall | -97.73942,30.28530,4 -> -97.73955,30.28250,2 | C (run A's pose was inside a tree) |
| 08 | Guadalupe (the Drag) at 23rd, east kerb, looking north | -97.74185,30.28520,1.7 -> -97.74175,30.28800,4 | C |
| 09 | Congress Ave at 9th, 30 m up, at the Capitol | -97.74212,30.26991,30 -> -97.74040,30.27470,60 | C |
| 10 | parking structure (State Parking Garage R, `dk06`, 29.9 m), 130 m SSW, 22 m up | computed | **B** (`captures-B/10-parking-structure-pPPP.jpg`) |
| 11 | Lady Bird Lake, 120 m up, looking ESE to the Congress bridge / downtown | -97.7600,30.2665,120 -> -97.7455,30.2625,0 | C |
| 12 | campus aerial (z16, pitch 68, bearing 200 — the old night-shots `core` pose) | center -97.7395,30.2860 | C |

Also: `captures-B/` (legacy-fallback run, all 12 views + `sheet-B-07-12.jpg`), `captures-runA/`
(views 01-09, legacy fallback, first pose set), `E1-*.jpg` light-colour A/B frames in B and C,
`captures-B/E7-atlas-*.png` + `E7-atlas-sheet.png` (facade atlas tiles read out of MapLibre's
image manager at the Congress eye pose), `sweep/` (13 hours x 2 poses + lamp/no-lamp splits,
`sweep.json`). Owner references (local only, never commit):
`austin-reference-images/_owner-phone/jpg/IMG_9964.jpg` (local, private; elevated WC,
20:36), `IMG_9970.jpg` (The Castilian, parking podium), `IMG_9977-9981` (street level, 03:05).

### 5.2 The schedules, evaluated in the page (formulas as shipped; `E6` in the report)

| p | sun° | street lamps | sky night | stars | facade windows | facade wall dark | heroes/arts | prop lamps | baked wn / three.js cNight | DKR mesh | sunlight+glass |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.54 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.08 | 0 | 1 |
| 0.56 | 0 | 0.156 | 0.031 | 0 | 0.029 | 0.022 | 0 | 0 | 0.12 | 0 | 1 |
| 0.58 | -2 | 0.5 | 0.094 | 0 | 0.087 | 0.222 | 0 | 0 | 0.16 | 0 | 0.741 |
| 0.60 | -4 | 0.844 | 0.156 | 0 | 0.144 | 0.444 | 0 | 0.074 | 0.2 | 0.01 | 0.259 |
| **0.62** | **-5.8** | **0.998** | 0.213 | 0 | **0.202** | 0.644 | **0** | **0.148** | **0.24** | **0.038** | 0.003 |
| 0.65 | -8.5 | 1 | 0.297 | 0.051 | 0.289 | 0.944 | 0.079 | 0.259 | 0.3 | 0.11 | 0 |
| **0.69** | **-12.1** | 1 | 0.409 | 0.446 | **0.404** | 1 | **0.184** | 0.407 | **0.38** | 0.246 | 0 |
| 0.75 | -17.5 | 1 | 0.578 | 0.994 | 0.578 | 1 | 0.342 | 0.63 | 0.5 | 0.5 | 0 |
| 0.80 | -22 | 1 | 0.719 | 1 | 0.722 | 1 | 0.474 | 0.815 | 0.6 | 0.714 | 0 |
| 0.90 | -31 | 1 | 1 | 1 | 1 | 1 | 0.737 | 1 | 0.8 | 0.99 | 0 |
| 1.00 | -40 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 |

Evaluated night map light at p=1: colour (0.561, 0.627, 0.878), intensity 0.04, MapLibre position
(0.784, 0.549, **-0.803**) — i.e. from below the horizon (the sun at -40°), not from the moon.

### 5.3 Frame statistics (run C unless marked; luma = Rec.709 on the graded JPEG)

| view | p=0.62 mean / p99 / %>120 | p=0.69 | p=1.00 | AE gain .62 / 1.0 |
|---|---|---|---|---|
| 01 skyline across lake | 103.8 / 165 / 48.1 | 70.7 / 118 / 0.22 | 8.9 / 58 / **0.00** | 1.20 / 0.85 |
| 02 Congress street | 79.8 / 142 / 2.4 | 64.7 / 117 / 0.33 | 17.0 / 76 / **0.00** | 1.20 / 0.85 |
| 03 WC elevated ION | 86.0 / 151 / 20.3 | 68.1 / 128 / 2.7 | 15.9 / 90 / 0.04 | 1.20 / 0.85 |
| 04 WC elevated NW | 90.8 / 154 / 34.3 | 69.1 / 123 / 1.6 | 14.8 / 89 / 0.13 | 1.20 / 0.85 |
| 05 WC street | 141.9 / 239 / 49.4 | 111.8 / 207 / 45.2 | 73.4 / 163 / 38.7 | 1.20 / 0.85 |
| 06 South Mall -> Tower | 86.5 / 166 / 22.3 | 72.3 / 152 / 19.4 | 21.3 / 90 / 0.35 | 1.00 / 0.85 |
| 07 terrace -> South Mall | 93.8 / 185 / 11.0 | 67.5 / 128 / 1.9 | 12.7 / 79 / 0.11 | 1.20 / 0.85 |
| 08 Guadalupe | 128.4 / 230 / 49.7 | 100.0 / 197 / 43.5 | 65.5 / 153 / 34.3 | 1.20 / 0.85 |
| 09 Congress -> Capitol | 84.4 / 214 / 31.1 | 65.9 / 207 / 22.4 | 44.3 / 163 / 10.8 | 1.03 / 0.85 |
| 10 garage (run B) | 45.3 / 57 / 0.02 | 26.8 / 43 / 0.01 | 15.9 / 42 / **0.00** | 1.20 / 1.00 |
| 11 Lady Bird Lake | 88.1 / 161 / 23.2 | 68.6 / 132 / 13.6 | 11.5 / 49 / 0.02 | 1.20 / 0.85 |
| 12 campus aerial | 90.1 / 153 / 16.1 | 69.3 / 127 / 1.7 | 15.2 / 79 / 0.04 | 1.20 / 0.85 |

- Pixels above luma 200 at p=1: **<= 0.001% in every view** (bloom's pre-grade threshold is
  ~0.775 = luma ~198, §2.1). At p=0.62 the only views with >1% above 200 are 05/08/09 — and that
  is lit GROUND (below).
- AE sits on its clamps at both ends: gain **1.20 (max) at blue hour in 10 of 12 views, 0.85
  (min) at full night in 11 of 12**.
- Region samples (run C): 01 p=.62 **lake luma 160.6** (193,154,129) vs sky 31.4 vs towers 58.1;
  11 p=.62 lake 154.2 (189,147,125); 11 p=1 lake 5.2 with std 0.58 (featureless). 04 p=.62 the
  authored tower's wall median **139** vs sky 32 (upper) / 96 (horizon); p=.69 wall 109 vs sky
  20 / 70; p=1 wall 13 vs sky 4. 08 p=1 carriageway **148** (184,143,94) vs the shopfront
  pavement **14**; 05 p=1 carriageway 151, std 9.4 (no pool structure).
- Owner photo IMG_9964 (reference only, phone auto-exposure, not a calibrated target): sky 39.8
  neutral grey (37,40,46); lit window colour (195,182,152); tower wall p50 67.

Slider sweep (`sweep/sweep.json`; `top` = upper 12% of frame = sky, `bot` = lower 60%):

| p | campus aerial all / top / bot / %>120 | WC street all / top / bot / %>120 of bot |
|---|---|---|
| 0.30 | 163.5 / 214 / 144 / 75.5 | 139.2 / 146 / 136 / 56.0 |
| 0.50 | 137.5 / 194 / 114 / 58.8 | 104.1 / 90 / 111 / 24.4 |
| 0.54 | 116.3 / 172 / 95 / 38.6 | 98.6 / 86 / 105 / 23.7 |
| 0.56 | 110.2 / 161 / 91 / 34.6 | 129.9 / 105 / **141** / **86.6** |
| 0.58 | 97.8 / 131 / 84 / 27.5 | 129.1 / 86 / **154** / 83.0 |
| 0.60 | 83.7 / **83 / 81** / 5.4 | 121.9 / 69 / 156 / 75.5 |
| 0.62 | 72.0 / **54 / 75** / 1.7 | 120.3 / 62 / 159 / 75.4 |
| 0.69 | 56.9 / 38 / 60 / 0.24 | 105.8 / 48 / 144 / 75.2 |
| 0.75 | 48.0 / 30 / 51 / 0.15 | 89.5 / 35 / 125 / 74.8 |
| 0.80 | 41.5 / 26 / 43 / 0.13 | 86.1 / 30 / 122 / 74.1 |
| 0.90 | 21.9 / 15 / 22 / 0.05 | 79.4 / 21 / 116 / 70.1 |
| 1.00 | 15.2 / 10 / 15 / 0.04 | 73.5 / 15 / 111 / 64.5 |

Lamp layers hidden (`night-streetlight-*`, `props-lit*`, `entrances-pool`, `signs-ground-glow`,
`night-tower-pool-fill`), same pose and hour: **WC street p=1 bot 110.2 -> 10.7, %>120 64.4 ->
0**; p=0.62 bot 158.4 -> 77.5. Campus aerial p=1: 15.8 -> 14.6 (lamps are +1.2 luma of the whole
aerial frame). (The campus-aerial p=0.62 split read 86.9 vs 89.0 — AE drift, not a result.)

### 5.4 Data and atlas measurements

- **Light-colour A/B (E1)**, same pose, p=1, only `setLight` colour changed to white (intensity
  unchanged 0.04), run C (apartments on): view 04 hot pixels **0.17% -> 4.71%**, p99 96 -> 177,
  hot mean RGB (158,136,105) -> (192,168,117); view 12 0.09% -> 1.39%, p99 96 -> 160. Restoring the
  light returns 0.25%/108 and 0.09%/96. Run B (legacy prisms) moved far less (0.19 -> 0.27%):
  the three.js apartments are where the tint costs most. Frames: `captures-C/E1-*.jpg`.
- **Facade atlas at walking height (E7)**, Congress eye pose p=1: MapLibre's image manager holds
  64x64 tiles that each contain ONE window (`E7-atlas-sheet.png`). `tg` (downtown curtain wall)
  lit-texel share is bimodal: 0 for 11 of 23 base ids, 0.49-0.56 (= the whole pane lit) for 12.
  Code: `repeatMAt(z) = 32*67551/2^z` m (`js/facades.js:245`) is 2.06 m at tile zoom 20; rows
  `round(R/pitchM)` clamp to >= 1 (`:361,:487-491`); anchor follows the camera up to z22
  (`:2610,:2975-2980`). So the per-pane roll `hash01(seed,0,0)` decides EVERY window of every
  building on that (family, bucket): 100% lit or 100% dark. Frame 02 p=1 shows it.
- **Pattern sharing (E2)**: 125 distinct `wp` atlas patterns across 2,860-3,337 queried
  facade features; the most common (`mr01`) is on 618-733 buildings, `mr02` 276-327, `mh01`
  170-176. `data/outer_tower_palette.json`: 10 tower buckets for 243 downtown tower walls, 6
  midrise buckets for 645 streetwall walls (`data/outer_ring.geojson`).
- **Outer ring night colours** (`data/outer_ring.geojson`, baked `wn`, luma p10/p50/p90): walls
  32/33/35 (6,866 low-rise prisms with NO windows), towers 26/30/36, ground-floor retail bands
  `k=r` **24/26/27**, crowns `k=c` 23/28/30, plazas 24. Street retail and crowns are darker than
  the walls above them, before the blue light multiply.
- **Street lamps vs mapped poles** (`lamp_audit.py`): 3,344 generated lamps (535 major / 839
  minor / 1,970 walk) vs 193 OSM `highway=street_lamp` in `data/walk_lamps.json`. Generated
  lamps with a mapped pole within 15 m: **2.2%** (25 m: 4.9%). Mapped poles with a generated lamp
  within 15 m: 31% (25 m: 51%). Nearest-neighbour spacing: generated p10/p50/p90 11/21/37 m,
  mapped 12/32/64 m. 10 generated walk lamps (0.3%) sit INSIDE a building footprint (2026-09-18
  snapshot, 2,453 footprints). (OSM under-maps lamps; the file says so. The 2.2% says the
  generated lamps are not where the mapped ones are, not that the mapped set is complete.)
- **Retint cost**: every forced `applyTimeOfDay` in the captures took **1.25-3.17 s** of
  synchronous main thread (run C; 0.86-3.56 s run A). Perf run, day<->night: 2.13-2.47 s sync.
- Style layer order (run B `E4-layers.json`): `entrances-pool` #127, `night-streetlight-pool/
  core` #137/#138, `buildings-3d` #140, `ground-paths` #145 (raised fill-extrusion), `props-lit`
  #153. The slopes custom layer does not appear in `getStyle()`.

### 5.5 Frame time, night vs day

Method (`LANES/night/code/night-perf-ab.mjs`): one headless hardware-GL Chrome per mode (ANGLE /
D3D11 on the RTX 3050 Ti Laptop GPU), 1440x900 dsf 1, `?intro=0&drift=0`, auto-detect cancelled,
authored apartments re-enabled and built before timing. Hours p=0.30 (day, sun +54°) and p=1.00
(night), order counterbalanced on alternate reps, 5 reps. Per run: retint + idle + 2.5 s, pose +
idle + 1.5 s, then
- FORCED = 40 x `map.redraw(); gl.finish()` at the parked camera (one full synchronous frame,
  CPU + GPU, excluding compositing and the CSS grade),
- SWEEP = 4 s linear `easeTo` of +60° bearing, rAF intervals.
**Machine state (desktop run, 06:18-06:40 CDT): CPU load 88% at start; the other two GPU slots
were held by other lanes' browsers the whole time; 1.8 GB of 15.4 GB RAM free.** Absolute
numbers are therefore pessimistic; read the day/night difference within a session, not the fps.

Desktop (`balanced`: renderScale 1, bloom 0.40, god rays 0.5, AE on), `perf-desktop.json`:

| view | hour | FORCED min ms [5 reps] | FORCED median-of-40, min [reps] | SWEEP fps [reps] | rAF p50 ms [reps] |
|---|---|---|---|---|---|
| campus aerial (z16, pitch 68) | day | **38.2** [46.2, 44.6, 38.2, 46.1, 53.5] | 49.5 [55.3, 53.5, 49.5, 55.2, 61.7] | 5.0-5.9 (one 1.1 outlier) | 108-198 |
| campus aerial | night | **45.9** [47.9, 45.9, 59.7, 56.6, 50.8] | 54.8 [54.9, 54.8, 71.4, 65.4, 58.6] | 3.9-5.7 | 108-146 |
| WC elevated NW (authored apts) | day | **29.3** [36.8, 29.3, 31.2, 29.3, 30.2] | 36.2 [44.9, 37.6, 37.7, 37.4, 36.2] | 3.1-6.2 | 109-234 |
| WC elevated NW | night | **30.1** [35.5, 30.1, 37.2, 43.9, 35.2] | 36.1 [44.6, 36.1, 44.2, 58.2, 44.4] | 3.4-5.4 | 144-198 |

Reading: WC — no measurable night cost (min 29.3 vs 30.1 ms, medians 36.2 vs 36.1, spreads
overlap completely). Campus aerial — night's minimum is 7.7 ms higher (38.2 vs 45.9) but the
spreads overlap (day 38-54, night 46-60) on a saturated machine: at most a weak signal, not a
result. SWEEP ran at 3-6 fps in both hours: the moving frame is dominated by something other
than the map render (forced frame 30-55 ms vs rAF p50 108-234 ms — bloom and AE both read the GL
canvas back every frame; plus the machine load). Not attributable to night.

One-off retint, same session: day -> night **2,263 / 2,132 ms** synchronous, night -> day
2,256 / 2,465 ms; `idle` did not arrive within the 20 s cap in 3 of 4 (17.7-21.5 s).
Boot to ready 106 s (the authored-apartment ceiling fired; re-enabled in page).

`?lite=1` (`perf-lite.json`, run 2026-09-19 08:28-08:39 CDT; the first attempt at 06:40 died
at boot and a second was cut off by the usage limit, neither produced data). Page reported
`preset performance, renderScale 0.75, bloom 0, godRays 0, autoExposure false,
campuslandscape=0`, canvas 1080x675, same GPU/ANGLE string, same poses, hours, method and 5
reps. Boot 38.9 s; the authored apartments were up without the re-enable. **Machine state:
CPU 68% at start / 66% at end, 4.4 GB RAM free; one other lane's browser held a GPU slot the
whole run and a second from 08:33.** That is a lighter load than the desktop run (88%, all
three slots busy), so desktop-vs-lite ABSOLUTE numbers are confounded by load; the
night-vs-day comparison within each run is the result.

| view | hour | FORCED min ms [5 reps] | FORCED median-of-40, min [reps] | SWEEP fps [reps] | rAF p50 ms [reps] |
|---|---|---|---|---|---|
| campus aerial | day | **22.1** [22.4, 26.9, 28.6, 22.1, 33.7] | 28.1 [28.1, 39.4, 37.7, 31.5, 43.1] | 9.2-15.7 | 36-72 |
| campus aerial | night | **14.5** [15.6, 31.7, 29.6, 22.1, 14.5] | 20.7 [20.7, 38.2, 39.0, 36.0, 22.3] | 10.2-22.5 | 36-72 |
| WC elevated NW | day | **11.0** [14.4, 18.5, 15.8, 11.2, 11.0] | 15.0 [20.3, 23.8, 23.8, 15.0, 15.0] | 12.3-15.5 | 54-71 |
| WC elevated NW | night | **9.7** [12.3, 9.7, 20.1, 16.5, 23.2] | 15.4 [20.9, 15.4, 25.0, 21.6, 26.9] | 9.8-15.4 | 37-72 |

Reading: no measurable night cost in lite either. Night's minimum is at or below day's in
both views (14.5 vs 22.1, 9.7 vs 11.0) and every spread overlaps. The campus-aerial +7.7 ms
seen in the desktop run does not reproduce here, which fits reading it as load noise (not
proven: the desktop run was not repeated at this load). rAF intervals cluster at 36/54/72 ms,
i.e. the headless compositor paces whole frames, so SWEEP fps is coarse.
Retint in lite: day -> night **967 / 1,023 ms** synchronous, night -> day 1,012 / 1,293 ms
(to `idle` 5.7-10.9 s), about half the desktop run's 2.1-2.5 s. Part of that may be the
lighter machine load; not separated.

---------------------------------------------------------------------------------------------------

## 6. Defects and implausibilities (ranked by how much of a frame they own)

Evidence tags: **[M]** measured above (pixels/data/timing), **[C]** read from code, **[V]** visible
in the named capture (a judgement from looking), **[H]** hypothesis, not verified.

1. **Dusk is lit like the afternoon; the sky goes dark first.** [M][V] Walls, ground and water
   ride p-linear golden->night ramps (`wn`, three.js `cNight`, ground `nightAmt`) while the sky
   and lamps ride the sun. At blue hour (p .62, sun -5.8°) the authored West Campus tower's wall
   is luma 139 against a sky of 32-96 (04-p062); at twilight (p .69, sun -12°) still 109 vs
   20-70. In the campus aerial the lower frame passes the sky at p .60 and stays brighter through
   the whole twilight (sweep: 75 vs 54 at .62, 60 vs 38 at .69). Lady Bird Lake at blue hour is
   the brightest surface in its frame: luma 161 (193,154,129) vs sky 31 (01-p062, 11-p062 — the
   water's golden key `#c9a184` is tan). Auto-exposure makes it worse: gain pinned at its 1.20
   ceiling at p .62 in 10 of 12 views.
2. **Nine uncoordinated schedules.** [C][M] §1 and §5.2. At p .62 street lamps are 99.8% on,
   facade windows 20%, three.js/baked night colours 24%, prop walk lamps 15%, hero/arts windows
   0%, DKR 4%. The one schedule `js/sky.js:119-173` asks everyone to use is used by the lamps and
   nothing else. Heroes and arts do not start until the sun is at -5.8°; three.js lit windows
   reach their lit colour only at p=1.
3. **Every emissive colour is multiplied by a blue "moonlight".** [M][C] The night map light
   (0.561, 0.627, 0.878) multiplies lit windows, signs, the Capitol floods and the apartment
   windows in both renderers. Setting only that colour to white at p=1 raises the >120-luma share
   from 0.17% to 4.71% and p99 from 96 to 177 on the WC view (E1). Lit panes land khaki-grey
   (158,136,105) against the owner photo's warm white (195,182,152); neutral-white panes land
   lavender (Congress p=1: the only >120 pixels average (171,177,196)). Unlit walls go purple.
   `js/tower.js` and `js/entrances.js` pre-divide by `#9aa6da`, which is no longer the night
   light (`#8fa0e0`).
4. **Near-field street light is a flat orange floor, and it is on the road, not the pavement.**
   [M][V] With the lamp layers hidden, the WC street p=1 lower frame drops from luma 110 to 11
   and its >120 share from 64% to 0: the pools ARE the street. The carriageway reads 148-151 with
   a std of 9 (no pool structure) while the Guadalupe shopfront pavement beside it reads 14
   (08-p100). Cause [C]: pools grow to 16.5-18 m ground radius near the eye
   (`js/night.js:240-241` x `LAMP_SPREAD` 1.5), sampled on road centrelines with a p50 spacing of
   21 m [M], and they sit at style index 137 below the raised `ground-paths` extrusion (#145), so
   kerbs and pavements are never lit (`js/night.js:414-440`). At sunset the WC street's lower
   frame jumps from 105 to 141 (sweep p .54 -> .56) — brighter at dusk than at noon.
5. **Lamps have no fixtures and are not where lamps are.** [M][C] 3,344 synthetic points on road
   centrelines; only 2.2% have a mapped OSM pole within 15 m; 10 are inside buildings; the
   "head" is a second disc on the ground (`js/night.js:483-495`), so no light exists at 4-9 m
   where a luminaire is. The 531 real prop poles are dark geometry; their pools use the stale
   p .58-.85 ramp (`js/props.js:109`).
6. **At walking height a building's windows are all lit or all dark.** [M][C] The metre-anchored
   atlas shrinks to one window per 64-texel tile at tile zoom 20 (E7), so one hash decides every
   window of every building on that (family, bucket). Congress p=1 (02-p100): whole towers of
   identically lit lavender panes beside whole towers of dark ones.
7. **Lit windows have no architecture.** [C][M] Per-pane coin flips, seeded by (family, colour
   bucket), shared across buildings (top pattern on 618-733 buildings, 125 patterns city-wide),
   repeating every 33 m tile (every 6-10 storeys) at flying zoom; per-pane tone mixes
   incandescent/fluorescent/TV-blue within one "unit"; constant occupancy all night. Authored
   apartments: 45% for every building, one tone `#d9b46a`, paired openings of one room and the
   two faces of a corner unit roll independently. No lobbies, amenity crowns, stair cores, office
   floors, cleaning-crew floors or late-night decay. Owner references show lit crowns, bright
   lobbies/retail podiums and unit-grouped windows (IMG_9964, IMG_9970, IMG_9977-9981).
8. **Downtown after dark is unlit at street level and dark at the top.** [M][V] Skyline across
   the lake at p=1: not one pixel above luma 120 (01-p100, p99 58). Congress p=1: 0% above 120.
   Retail bands (`k=r`, 751) and crowns (`k=c`, 335) are baked darker than the walls; 6,866
   outer low-rise prisms have no windows; no crown lighting anywhere downtown. And downtown has
   NO street lights: the lamp generator is fenced to the campus buildings bbox + 150 m
   (`js/night.js:547-567,623`), logged in every run as `fenced -97.754..-97.724 /
   30.269..30.297`. Everything south of 30.269 — Congress below ~8th St, 2nd/6th Street, the
   lake shore, the bridges — is unlit (02-p100: an empty black avenue under lit towers).
9. **The campus core is black at eye level.** [M][V] South Mall from the terrace p=1: mean 12.7,
   p99 79 (07-p100); Main Mall -> Tower p=1: mean 21.3 — only the Tower's floods and a few panes.
   The malls' lamps exist in OSM (193 mapped) but render only as small ground pools.
10. **Water is a flat plane at every hour.** [M][V] No reflection path exists in code. At night
    the lake is luma 5.2, std 0.58 (11-p100): the skyline has no reflection, the bridges no
    lights. At dusk it is the tan sheet of defect 1.
11. **Bloom and exposure do nothing useful at night.** [M][C] Pixels above luma 200 at p=1:
    <= 0.001% in all 12 views, so the bloom's ~0.775 raw threshold has nothing to act on; its
    256-px downscale also averages a 1-2 px window away. AE pins at 0.85 (min) at p=1 in 11 of
    12 views, i.e. it darkens the night by 15% everywhere.
12. **Night sky reads as outer space, not a city sky.** [M] Upper sky luma 4 at p=1 (04), zenith
    `#040713` with 520 stars at full strength by sun -18°; the owner's 20:36 photo has a neutral
    grey sky at ~40 and no visible stars. The skyglow band peaks at alpha 0.052.
13. **The night light comes from under the ground.** [M][C] Map light position z = -0.803 at
    p=1 (sun at -40°), while the drawn moon is at az 118°, +24°. At intensity 0.04 this barely
    shades anything, which is itself the point: the night city has no moonlit side, no shade side.
14. **Parking decks at night are a thin blue edge line.** [V][C] (run B 10-p100: >120 share 0,
    p99 42). `dk` has occupancy 0 and no ceiling light (`js/facades.js:2029-2045`); the owner's
    Castilian podium (IMG_9970) is a lit cool-white deck with visible fixtures.
15. **Glass reflection vanishes at night instead of mixing with interior light.** [C]
    `cityShade()` returns the original colour at `u_sunPresence <= 0` (`js/city-lighting.js:61`),
    and between sun 0° and -6° it LERPS lit panes toward the reflected sky (`:78`) rather than
    adding interior light to reflection.
16. **Ground pools with no source.** [C] 48 brand-coloured sign pools at sign anchors, text
    signs in screen space rather than on facades; 115 m uniform Tower pool; a pool per door leaf
    for all 1,413 doors. [C] Door leaves are 5-point polygon rings and MapLibre 5.24.0's circle
    bucket draws one circle per ring point (§4), so every leaf stacks 4-5 pools: authored alpha
    0.30 becomes ~0.76-0.83 at the door (arithmetic; not measured in pixels). Fix: feed the
    pool layer a point per leaf (centroid) instead of the polygon.
17. **Retinting to night costs 1.0-3.2 s of main thread** [M] per forced `applyTimeOfDay` (run
    C 1.25-3.17 s), 2.1-2.5 s day<->night in the desktop perf session, 0.97-1.29 s in the
    `?lite=1` session (lighter machine load) — every facade atlas, basemap layer, prop,
    ground and stadium expression is rewritten on the heavy path (`js/timeofday.js:379-482`).
18. **Slow machines lose the authored apartments at night and day alike.** [M] The 90 s authored
    handoff ceiling (`js/app.js:1945-1950`) fired in 4 of 5 boots here; run B's West Campus at
    night is legacy prisms with blurred scatter windows (compare `captures-B/04-*` and
    `captures-C/04-*`). Not a night defect, but it decides which night renderer a visitor gets.
19. **Stale/duplicate constants** [C]: `#9aa6da` pre-division (defect 3); `props` and
    `entrances` fallback ramps .58/.85 documented as wrong in `js/sky.js:119-160`; WC tier-four
    night ramp duplicated between `js/westcampus.js:535-583`, `js/slopes-apartments.js:488` and
    `scripts/bake_westcampus.py`.

## 7. PROPOSED (not built, not measured — for Codex to accept or reject)

- One clock: every emitter and every night colour keyed to `skyBodies(p)` (sun elevation), with a
  separate "artificial light on" curve per class (street, window, retail, flood, crown) authored
  in sun degrees, and walls/ground/water darkening on the sun, not on p.
- A real emissive channel that bypasses the map light multiply in both renderers (fill-extrusion
  via the existing `city-lighting.js` shader patch, three.js via a `cEmit` attribute), so lit
  windows and signs keep their authored colour and can exceed the diffuse range for bloom.
- World-anchored window identity: floor index from height / storey pitch and bay index from
  along-wall metres (the apartments already have both), a per-building seed from the feature id,
  and occupancy by UNIT (grouped bays), by FLOOR (office floors, lobbies, amenity crowns), with a
  late-night decay curve. The atlas cannot carry position; the three.js path and a shader-side
  hash on world position can.
- Street lights from mapped poles first (OSM `street_lamp` + kerb-offset synthetic fill where
  OSM is empty), a visible head at fixture height (depth-tested sprite or small emissive mesh),
  and pools drawn after the pavement stack with a physical falloff so near-field pools stop
  merging.
- Water: sky + skyline reflection (screen-space or a mirrored low-res pass) and lamp streaks.
- Missing night classes: lit crowns / amenity levels, ground-floor retail and lobbies, lit
  garage ceilings, aircraft-obstruction reds, traffic (optional), and an urban skyglow sky.
- Bloom on an emissive buffer (or a threshold keyed to the hour) instead of the whole frame at
  a fixed ~0.775.
