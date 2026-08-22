# Ground pattern map — for the build lane, not a summary

Read-only pass, no browser, no server. Everything below is quoted or line-cited
from `js/ground.js` as it stands on `origin/main` at the time of reading, plus
`maplibre-gl@5.24.0` engine source fetched fresh (same version
`docs/pattern-sampling.md` read, tag `v5.24.0`, no vendored copy in this repo).
Written for the QUEUE item asking whether the ground's own `fill-pattern`
layers can receive the same `window.PatternLowpass.blurWrap` treatment that
fixed the facades, or whether the grazing-angle ground plane makes that a
different, possibly unfixable, problem.

## 1. The three `fill-pattern` layers

A literal grep for `'fill-pattern'` (not `'fill-extrusion-pattern'`, not
`'background-pattern'`) in `js/ground.js` returns exactly three hits, matching
the task brief's count:

| id (constant) | line | drawn area | pattern expr | zoom range | image(s) |
|---|---|---|---|---|---|
| `ground-texture` (`TEX`) | 1588–1598, pattern 1593 | every `k:'area'` polygon except the creek (`NOT_CHANNEL`) — lawns, plazas, pitches, parking, canopy beds | `texPatternExpr()` (1257–1262), `['match',['get','s'],…]` keyed on surface `s`, mapped through `TEX_FAMILY` (593–604) to one of 5 far-field images | `minzoom: GROUND.minZoom` = **13.5** (line 34), no maxzoom — live at every flying altitude | `TEX_IMG` (444–446): `gnd-tex-{grass,asphalt,water,paving,canopy}` |
| `ground-close-area-grain` (`CLOSE_AREA`) | 1607–1618, pattern 1613 | same `k:'area'` polygons, minus water/canopy (`closeAreaFilter`, 1307–1311) | `closeAreaPatternExpr()` (1313–1321), same `s`→family map, close-range images | `minzoom: GROUND.closeFadeZoom[0]` = **18.8** (399–400) — walking-height only | `CLOSE_IMG` (451–452): `gnd-close-{grass,asphalt,paving}` |
| `ground-close-road-grain` (`CLOSE_ROAD`) | 1672–1684, pattern 1679 | `k:'roadarea'` (the carriageway polygon, `ROADAREA_FILTER`, line 728) | **not data-driven** — a single fixed image, `CLOSE_IMG.asphalt` | `minzoom: 18.8`, same close gate | `gnd-close-asphalt` (shared with `CLOSE_AREA`'s asphalt case) |

A fourth site samples the same atlas through a different paint property and is
worth knowing about even though it isn't one of the three: `ground-base-texture`
(`BASE_TEX`, 1525–1534) is `type: 'background'` with `'background-pattern':
TEX_IMG.paving` — same registered image, same `ImageManager` atlas, a
different MapLibre shader path (`bgPatternUniformValues`, confirmed in
`src/webgl/program/pattern.ts` — see §5). It undercoats the *entire* screen
(`minzoom: GROUND.minZoom`, `maxzoom: GROUND.texGroundMaxZoom` = 24) wherever
nothing else paints over it, so it is arguably the single largest-area pattern
sample in the scene, just not a `fill-pattern` one.

**All three (and `BASE_TEX`) are `type: 'fill'` / `'background'` — flat 2D,
`fill-extrusion-base`/`height` do not apply.** They sit on the literal ground
plane. Contrast with §6 below: `js/ground.js` also carries four
`fill-extrusion-pattern` layers (the walk deck, its close-range grain, the
Speedway brick, the creek ripple) that the task's own list of "the D6/D7 grain,
scored deck, brick weave" actually points at — those are a different paint
property and are covered separately because they are geometrically thin
*extrusions* standing a few centimetres proud of the plane, not the plane
itself.

## 2. How each pattern image is produced

**Canvas, drawn once, cached forever, keyed on a fixed string id — never
re-rendered.** Every `initTextures(map)` call site (1206–1241) guards with
`if (map.hasImage && map.hasImage(id)) continue;` before calling
`map.addImage`. Unlike `js/facades.js`'s atlas — one image per
`(family, colour-bucket, HOUR)`, redrawn on every time-of-day tick — these
carry **no colour at all**. Every drawing function's own header says so
(`drawCloseTexture`'s comment, 968–980: *"Pure alpha modulation like every tile
above"*), and `applyGroundColors`/time-of-day retinting is done entirely
through `fill-opacity`/`fill-extrusion-opacity` expressions (`texOpacityExpr`,
`closeAreaOpacityExpr`, `pathTexOpacity`, etc.), never by touching the pixels.
**This means there is no per-repaint cost question here at all** — a call to
`PatternLowpass.blurWrap` inside these functions runs once per page load per
image, not once per hour-tick like the facade atlas, so `js/facades.js`'s own
57.7 ms → 119.7 ms repaint-cost story (§4 of `docs/facade-atlas-map.md`)
**does not apply to ground.js by construction.**

Four drawing functions, one per pattern family of images:

- `drawTexture(family, T)` (877–966) — the far-field `TEX_IMG` set. Returns
  `{width:T, height:T, data: Uint8Array}` at line 965.
- `drawCloseTexture(family, T)` (981–1020) — the close-range `CLOSE_IMG` set.
  Same return shape, line 1019.
- `drawHerringbone(T, cells, angDeg)` (1046–1107) — the one `HERRING_IMG`
  (Speedway brick). Same return shape, line 1106.
- `drawScoredBars(T, angIdx, variant)` (1148–1204) — the 16 `WALK_IMG(o)`
  sidewalk-scoring tiles (`o = angle*NV + variant`, `walkImgCount()` =
  `pathSlabAngles.length * pathSlabPhase.length` = 8×2 = 16, lines 456–458).
  Same return shape, line 1203.

**Every one of them ends the identical way**, and it is the exact hook a fix
would need (quoting `drawTexture`, 964–966, but all four match):

```js
const d = ctx.getImageData(0, 0, T, T);
return { width: T, height: T, data: new Uint8Array(d.data.buffer.slice(0)) };
```

`ctx.getImageData()` returns a `Uint8ClampedArray` — the exact type
`PatternLowpass.blurWrap`'s own JSDoc asks for (`pattern-lowpass.js:49`,
`@param {Uint8ClampedArray} d`) — and the conversion to a plain `Uint8Array`
copy happens **after** this line, not before. So `blurWrap(d.data, T, r, a)`
slots in cleanly on the line immediately above each of these four returns,
mutating the clamped buffer in place before it gets copied out. No format
mismatch, no awkwardness — see §6.

**Pixel dimensions and `pixelRatio`.** Every `T` passed to these functions is
a taste constant, not device-scaled:

| image set | `T` (texels) | constant |
|---|---|---|
| `TEX_IMG` | 64 | `GROUND.texTile` (277) |
| `CLOSE_IMG` | 96 | `GROUND.closeTile` (401) |
| `HERRING_IMG` | 48 | `GROUND.speedwayTile` (168) |
| `WALK_IMG(o)` | 64 | `GROUND.pathSlabTile` (240) |

**No call site passes a `pixelRatio` option to `map.addImage`** — grepped, zero
hits in this file. `docs/pattern-sampling.md` §2 already establishes
`displaySize = texels / pixelRatio`, and MapLibre's own default for an omitted
`pixelRatio` is 1, so `displaySize` (the CSS-px-equivalent width of one
repeat) **equals the raw texel count exactly** for every image in this file —
`texTile:64` registers as a 64-CSS-px repeat, `closeTile:96` as 96, and so on.
Contrast `js/facades.js`, which explicitly computes
`SCALE = clamp(round(devicePixelRatio), 1, 2)` and draws `RES = TILE * SCALE`
texels specifically so a retina screen gets 2 texels of oversampling headroom
per CSS px before minification even starts (`docs/facade-atlas-map.md` §1).
**`js/ground.js` has none of that headroom, on any display.** This is a
structural fact from the source, not a runtime measurement — see §8 for what
it does and doesn't imply.

## 3. The finest real-world feature per pattern, in metres

Every one of these images is `fill-pattern`/`fill-extrusion-pattern`, which
`docs/pattern-sampling.md` §2 and this file's own comment (line 269–275)
independently establish is **anchored in tile space at the image's native
pixel size and resets every integer zoom** — `pattern-scale.mjs`'s own finding,
quoted at 269–275: *"a 32 px tile measured 33.0 m across at z16, 16.5 m at z17
and 8.2 m at z18 … the feature size in metres HALVES every zoom level."* So
"finest feature in metres" is not one number — it is one number **at whatever
zoom the calibration comment gives**, continuing to halve above it. Quoting
each one's own stated calibration rather than re-deriving it:

- **`TEX` (far-field, 64 px tile)**: line 277, *"`texTile: 64,  // px =>
  ~66 m at z16, ~33 m at z17, ~16 m at z18`."* The finest drawn feature in
  every family is a **1-px speckle** (`speckle(ctx, T, rand, n, maxA, 1)`,
  called for grass/asphalt/paving/canopy at 700–2100 count — 869–875,
  907/919/922/952/959). One texel = 66/64 ≈ **1.0 m at z16, 0.52 m at z17,
  0.25 m at z18**, continuing to halve above that — at `street-drag`'s own
  z19.017 (see §7), roughly **0.12 m**. The `water` family is the one
  exception: its finest content is four sinusoids at integer frequencies up to
  `(3,-2)` cycles per tile (934–939) — a genuinely coarse, low-frequency
  pattern by construction, plus its own 1-px speckle on top (line 952).
- **`CLOSE_IMG` (close-range, 96 px tile, `CLOSE_AREA`/`CLOSE_ROAD`)**:
  quoted directly at 977–979 — *"At z20 a 96 px tile is ~6.2 m of ground, so a
  1 px speckle is a ~6 cm stone — true aggregate scale."* Density is far
  higher than the far-field tile: `asphalt` alone is
  `speckle(…, round(T*T*0.55), 0.16, 1)` **plus**
  `speckle(…, round(T*T*0.06), 0.10, 2)` (990–991) — more than half the tile's
  texels carry a 1–2 px chip. This is the single highest-frequency, highest-
  duty-cycle pattern in the file, by its own design intent (§4 quotes why).
- **`HERRING_IMG` (Speedway brick, 48 px tile)**: `JOINT = Math.max(0.9, W *
  0.09)` (line 1055) — with `W = T/(cells*period)` ≈ `48/(2×4×√2)` ≈
  **4.24 texels** per half-brick, `JOINT` evaluates to **0.9 texels**, i.e. it
  is pinned at the `Math.max` floor. The file states the real-world size
  directly (159–161): *"makes a 'brick' 1.61 x 0.80 m — 7.9x over-scale — and
  1.6 px wide at 400 m. That is the smallest thing that can read at all."*
  This is the one pattern in the file whose own comment admits its finest
  feature is **already at the Nyquist floor by design**, not as a side
  effect.
- **`WALK_IMG(o)` (sidewalk scoring, 64 px tile)**: the joint is
  `jw = GROUND.pathSlabJoint = 0.11` (249) of one band, and a band is
  `GROUND.pathSlabPx = 8` **screen** px nominal (248, *"8 px is about 4 m of
  ground at z17"*) — so the joint itself is ≈0.9 px ≈ **0.44 m at z17**,
  continuing to shrink at higher zoom the same way. **This is the one pattern
  in the file that already has an explicit anti-alias measure built into its
  own rasterizer**: `drawScoredBars`'s 3×3 supersample (1173–1191, quoted
  verbatim), *"A joint is about one texel wide, and one texel wide and
  hard-edged is what makes a repeating line pattern crawl and alias once it is
  minified across a city."* This softens the hard step into a graded ramp at
  draw time — it does **not** lower the joint comb's fundamental frequency
  (still `k` ≈ 8 cycles per 64-px tile at the nominal angle), so it reduces
  ringing at the edge without band-limiting the periodic signal itself. Worth
  flagging: the file's own authors already recognised exactly the aliasing
  risk this ticket is investigating, on exactly this layer, and already
  shipped a partial mitigation for it — three weeks before the current brief.

## 4. The authored taste block — quoted, and what a band-limit would and would not touch

The whole block is `GROUND` at lines 30–416; the parts naming the walking-
surface grain specifically:

> ```
> // ── The walking surfaces' grain (D6/D7) ───────────────────────────
> //
> // BOTH of these ride ON TOP OF the path deck, and that is the whole point.
> // ...
> // So a pattern that belongs to the deck has to STAND ON the deck. Both
> // layers are fill-extrusions from `pathRaise` to `pathRaise + pathTexLift`,
> // exactly the trick CHANNEL.sheen_m already uses over the water...
> pathTexLift: 0.02,      // m the grain stands proud of the deck it sits on
> ```
> (lines 174–191)

`pathTexLift` (0.02 m) is **geometry**, not pixel content — it is the vertical
offset that resolves a depth-sort tie between the scored-bar extrusion and the
plain path deck under it. A pixel-domain low-pass on the *image* cannot touch
it and would not need to; it is orthogonal to the aliasing question entirely.

> ```
> // "sidewalks look like bathroom tiles. ... At first it looked like tape now
> //  it looks like bathroom tiles."
> // ...
> // PANEL TO PANEL VARIATION IS MOST OF WHAT SELLS IT.
> pathSlabPanelVar: 0.075,
> ```
> (lines 197–259, the scored-deck block)

**What a band-limit would visibly damage here**: `pathJointDark` (0.22, the
joint's own contrast) and the joint width itself (`pathSlabJoint: 0.11`) are
exactly the high-contrast, near-Nyquist edge a box blur softens by
construction — that is the intended effect, same as it was on the facade
window mullions. **What it would not touch**: `pathSlabPanelVar` (per-panel
lightness jitter, a *low*-frequency signal — one flat tone per whole panel,
period = one slab width, nowhere near Nyquist) and `pathTexOpacity`/
`pathJointDark`'s overall darkness level, both scalar multipliers applied
outside the image (`pathTexOpacity(p)`, 1295–1298) — a spatial blur inside the
tile cannot move either.

> ```
> // A 30 ft golden sand-molded brick corridor in a HERRINGBONE bond...
> // OVER-SCALE, DECLARED. ... 1.6 px wide at 400 m. That is the smallest
> // thing that can read at all, and it is what makes Speedway read as laid
> // units rather than as another grey ribbon.
> speedwayTile: 48,
> ```
> (lines 150–172)

**What a band-limit would visibly damage**: the brick joint (`JOINT`, already
at its 0.9-texel floor) and the per-brick lightness scatter
(`v = t < 0.30 ? -(0.05+t*0.25) : (0.03+(t-0.30)*0.22)`, line 1090) — both are
single-texel-scale content, and the comment already says this is "the smallest
thing that can read at all." Blurring it is the one case in this file where
the taste-block's own words predict the band-limit could erase the motif
entirely, not just soften it, because there is no headroom above the floor to
give up. **What it would not touch**: `speedwayAngle` (45°, the corridor
axis), `speedwayOpacity`/`speedwayNightFade` (scalar, outside the image).

> ```
> // ── Texture ───────────────────────────────────────────────────────
> // MEASURED (scripts/verify/pattern-scale.mjs): fill-pattern is anchored in
> // TILE space ... That is why these tiles are blobs and speckle and nothing
> // else.
> texTile: 64, texOpacity: 0.62,
> texStrength: { grass: 1.0, asphalt: 0.9, water: 0.95, paving: 0.5, canopy: 1.0 },
> ```
> (lines 268–281, the lawn/asphalt/water/paving grain)

**What a band-limit would visibly damage**: the 1-px speckle component in
every family (§3) — again, exactly the content a box blur removes first.
**What it would not touch, and this is the file's own stated design intent,
not a guess**: the *shapelessness* of the blobs is explicitly the goal —
*"Deliberately still shapeless at the small end … crowns at three sizes with
random centres have no period to count"* (894–897, canopy; the grass comment
at 909–913 says the same about not reading as "mown stripes and beds"). A
gentle blur that removes the 1-px speckle floor while leaving the 3–20 px
blobs intact would, if anything, **reinforce** this stated goal rather than
fight it — the blobs are already the low-frequency content the file wants to
keep, and the speckle is the part explicitly there for grain, not for a
countable motif.

**In short: nothing in the taste block objects to band-limiting on principle.**
Every one of these comments is arguing for *shapelessness* or *softness at the
joint*, which is the same direction a blur pushes. The one place the file's
own words predict real damage is the Speedway brick, because its finest
feature is stated to already be at the readability floor with no headroom
left to spend.

## 5. `fill-pattern` sampling in MapLibre v5.24 — same mechanism as `fill-extrusion-pattern`, confirmed against source

`docs/pattern-sampling.md` covers `fill-extrusion-pattern` only. Fetched fresh
for this pass, tag `v5.24.0`:

**The fragment shader is functionally identical.** `src/shaders/glsl/
fill_pattern.fragment.glsl`:

```glsl
vec2 imagecoord = mod(v_pos_a, 1.0);
vec2 pos = mix(pattern_tl_a / u_texsize, pattern_br_a / u_texsize, imagecoord);
vec4 color1 = texture(u_image, pos);
```

— the same plain `texture()` call against the same one-mip-level `LINEAR`
sampler `ImageManager.bind()` creates (`docs/pattern-sampling.md` §1; that
binding is per-atlas-texture, not per-layer-type, so it applies unchanged
here). No LOD to fall back to; any minification past one texel per screen
pixel aliases with zero tolerance, exactly as already established for walls.

**The vertex shader uses the same `u_scale`/`get_pattern_pos` machinery**,
confirmed in `src/shaders/glsl/fill_pattern.vertex.glsl`:

```glsl
float tileZoomRatio = u_scale.x;
...
v_pos_a = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower,
                           fromScale * display_size_a, tileZoomRatio, a_pos);
```

and the uniform-computation function is the literal same one for both layer
types: `src/webgl/program/pattern.ts` exports exactly two functions,
`patternUniformValues` (used by both `fill` and `fill-extrusion` pattern
draws) and `bgPatternUniformValues` (used by `background-pattern`, i.e.
`BASE_TEX` too). There is no `fill`-specific or `fill-extrusion`-specific
variant of the uniform math — one function serves every pattern-bearing layer
type in the engine.

**The one real difference is the position projection, and it matters here.**
`fill_pattern.vertex.glsl`: `gl_Position = projectTile(a_pos + u_fill_translate,
a_pos);` — a flat 2D tile-space projection, no elevation term at all.
Contrast `fill_extrusion_pattern.vertex.glsl`
(`docs/pattern-sampling.md` §3): `u_projection_matrix * vec4(posInTile,
elevation, 1.0)` — a wall has a 3D position, so its instantaneous minification
is a function of distance, facing angle, *and* pitch. A ground `fill` has no
elevation term to add or subtract; its minification comes from exactly one
thing, the ordinary perspective divide applied to a point that is always
`z=0` in tile space. **That is the source-level confirmation of the task's own
premise**: a wall's minification varies with view angle across three degrees
of freedom and can be face-on; a flat ground plane's minification is driven
purely by how obliquely the camera looks at `z=0`, which at a 76° pitch (see
`street-drag`, §7) is about as oblique as this app's own pitch ceiling allows,
and there is no "face-on" case for the ground the way there is for a wall.

**Verdict: sampled identically at the shader/atlas level, geometrically worse
positioned to avoid the failure mode.** Nothing about `fill-pattern` gives the
ground plane an escape route `fill-extrusion-pattern` doesn't also have — if
anything the reverse.

## 6. Can `blurWrap` hook in as the code stands?

**Yes, mechanically, with no restructuring.** Four call sites, each the single
line immediately before the function's own `return` (§2 quotes the exact
line for `drawTexture`; the other three end identically):

- `drawTexture`, before line 964 (`const d = ctx.getImageData(...)`) — insert
  `window.PatternLowpass.blurWrap(d.data, T, r, a)` between `getImageData` and
  the `return`.
- `drawCloseTexture`, same shape, before line 1018.
- `drawHerringbone`, same shape, before line 1105.
- `drawScoredBars`, same shape, before line 1202 — but see §3: this one
  already runs 3×3 supersampling over the whole tile before this point, so a
  post-hoc `blurWrap` here would be a *second* smoothing pass stacked on the
  first, not a replacement for it.

No `addImage`/`updateImage` call site needs to change — the blur runs on the
pixel buffer before it is ever handed to MapLibre, exactly the same order
`js/facades.js`'s own `softenTile` already runs in (per `pattern-lowpass.js`'s
own header, this kernel is lifted verbatim from that call site). **The one
thing that would need to be built, not reused**: every one of these four
functions is called with a bare `T` and no radius/amount parameter today —
`initTextures` (1206–1241) would need its own `SOFTEN`-shaped taste table
(radius `r`, amount `a`, presumably per family the way `js/facades.js` and
`js/drag.js` each keep their own — `pattern-lowpass.js`'s header explicitly
says a shared *kernel* was the right cut, a shared *config* was not, §
comment lines 10–16). That table does not exist in `js/ground.js` today and
is new work, not a wire-up of something already there.

## 7. Ranking by expected benefit — and the honest uncertainty in it

Ranked by (screen-area coverage at poses this app actually flies) × (how much
of the pattern's own content is genuinely high-frequency, single-texel-scale
noise, which is what a box blur removes) × (how much stated headroom the
taste block leaves before the motif itself is gone):

1. **`CLOSE_AREA` + `CLOSE_ROAD` together (the 96 px close-range tiles).**
   Highest duty-cycle, highest-frequency content of any pattern in the file by
   a wide margin (asphalt: >55% of texels carry a 1–2 px chip, §3) and — this
   is the load-bearing fact for THIS ticket — **both are actually live at the
   `street-drag` pose measured in `docs/second-front-verdict.md`**:
   `shimmer-poses.json` puts `street-drag` at `zoom: 19.017, pitch: 76, alt:
   25 m`, which is *above* `closeFadeZoom[0] = 18.8`. So the pose the brief
   calls "the worst pose in the city" is not exclusively hitting the coarse
   far-field `TEX` tile — it is close enough that the dense close-range
   asphalt/paving grain is also painting. Their own header (969–980) is
   explicit that the content is *meant* to be scale-free noise with no
   countable motif, which is the best-case scenario for a blur: nothing named
   above predicts damage from softening it, only from removing it entirely at
   a radius large enough to flatten the aggregate look — a taste call, not a
   structural one.
2. **`TEX` (the far-field lawn/asphalt/water/paving grain).** Lower
   duty-cycle than the close tiles (blobs are the dominant content, speckle is
   additive, not >50% coverage), but it is the one pattern live at **every**
   flying altitude (`minzoom: 13.5`, no gate) and covers the largest total
   footprint of any single pattern in the scene by area. Its own header
   explicitly wants shapelessness, so the failure mode a blur risks (§4) is
   the mildest of the three.
3. **`HERRING_IMG` (Speedway brick).** Smallest footprint by far — one
   corridor — and, per its own comment, **already at the resolution floor by
   design** (§3). This is the one pattern where the file's own words predict
   a blur could erase the motif rather than merely soften it, so it is both
   the lowest-benefit target (small area) and the highest-risk one (least
   headroom). Rank it last, and treat any fix here as a separate, careful,
   eyes-on tuning pass rather than something to sweep with the same radius as
   the other two.

**The `WALK_IMG` sidewalk-scoring tiles are a wildcard, not ranked in the
three above because they are `fill-extrusion-pattern`, not `fill-pattern`
(§1), but flagged because they may matter more than any of the three ranked
layers**: they are live at every altitude (`minzoom: 13.5`, same as `TEX`),
they run the length of every scored walk in the city, and — per §3 — the
"two full-width clusters, y≈559–899" `docs/second-front-verdict.md` measured
at `street-drag` are two horizontal bands, not one continuous mass, which is
more consistent with two parallel sidewalks either side of Guadalupe than
with the single, continuous carriageway fill. **This is a hypothesis, not a
finding** — no browser was used to confirm which layer actually owns those
pixels, and `docs/second-front-verdict.md`'s own "byte-identical at every
radius" note describes a sweep of `js/drag.js`'s SOFTEN knob (a different
file's atlas entirely, ported by `acer/f2-helper`) against those pixels — it
is not evidence that blurring *ground.js's own* images would fail there, only
that blurring an unrelated file's images predictably did nothing to them.
Whether `PATH_TEX` is actually the dominant contributor at `street-drag` is
untested.

## 8. Anisotropy — the open question this map cannot close

The task's own premise is right and the source confirms it structurally (§5):
a flat ground plane viewed at pitch 76 has no face-on case the way a wall
does, so its per-frame minification is likely far more anisotropic (compressed
hard in the view direction, barely at all across it) than anything measured on
the facades. `PatternLowpass.blurWrap` is an **isotropic** box blur — it
softens both tile axes equally by construction (`pattern-lowpass.js`, the
horizontal pass then the vertical pass, same radius `r` both times, no
directional parameter exists in the function signature at all). Two outcomes
are both plausible from the source alone and **neither is decidable without a
runtime measurement**:

- It could work about as well as it did on facades — the close-range tiles
  are noise, not a directional grid, and isotropic noise blurred isotropically
  stays noise, just coarser noise, regardless of which screen direction it
  gets viewed from.
- It could underperform relative to its facade result — an isotropic radius
  large enough to band-limit the compressed (near-grazing) axis will
  over-soften the other axis, which is exactly the "turn the road to mush up
  close" failure mode the task brief names, and the honest floor for how much
  it can help is set by the more-compressed axis, not the average of the two.

Nothing in this pass — reading `js/ground.js`, the taste block, or the
MapLibre source — can settle which of those is closer to true. That needs
`scripts/verify/shimmer.mjs` run against a real candidate build, boxed the way
`docs/second-front-verdict.md`'s `street-drag-wall` pose boxed the walls out
of the whole-frame number, but boxing the *ground* out of the walls this time
to isolate what the ground's own patterns contribute in isolation from
`js/drag.js`'s already-fixed wall.

## What this map does NOT establish

- Which layer actually owns the "two full-width clusters" `docs/
  second-front-verdict.md` measured at `street-drag` — `PATH_TEX`,
  `CLOSE_ROAD`, and `CLOSE_AREA` are all structurally live at that pose (§7);
  no browser was used to attribute the pixels to one of them.
- Whether an isotropic blur actually reduces the measured crawl on any of
  these four patterns, by how much, or whether it visibly damages the walk
  deck / Speedway brick / lawn grain at any radius — none of `shimmer.mjs`,
  `ground-luma.mjs`, `ground-flatness.mjs`, or `tex-inspect.mjs` was run.
  Everything in §7's ranking is a prediction from source and stated design
  intent, not a measurement.
- Live atlas dimensions, total registered image count, or actual texel
  density on screen at any specific pose — this is derivable in principle
  from `map.style.imageManager` but needs the browser, which this pass did
  not start.
- Whether `pixelRatio` defaulting to 1 (§2) has any measurable effect on
  aliasing in either direction on a real hiDPI display — flagged as a
  structural difference from `js/facades.js`, not established as a
  contributor either way (the reasoning cuts both ways depending on whether
  the framebuffer itself is device-scaled the same way the pattern rect is,
  which needs a runtime read, not a source read).
- Whether the `BASE_TEX` background-pattern layer (§1) is worth including in
  any fix — it shares `TEX_IMG.paving`'s image, so fixing `TEX` would fix it
  for free at the pixel level, but its own contribution to the measured crawl
  at any pose was not estimated here.
