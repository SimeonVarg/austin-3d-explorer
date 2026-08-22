# Pattern atlas sampling — what the MapLibre source actually does

Read for: the window-shimmer defect (`docs/shimmer-brief.md`). Answers whether
"linear-filtered, no-mipmap pattern atlas aliases on minification" is
consistent with the code this app runs.

**Version read: `maplibre-gl@5.24.0`**, pulled from `unpkg.com` — `index.html:22-23`.
No vendored copy exists in this repo (`vendor/`, `lib/`, `node_modules` all
absent for it), so the source was fetched from GitHub tag `v5.24.0`
(`raw.githubusercontent.com/maplibre/maplibre-gl-js/v5.24.0/...`).

## 1. Mipmaps and filters — NO mipmap, LINEAR/LINEAR

`ImageManager.bind()`, `src/render/image_manager.ts:288-298`:

```ts
bind(context: Context) {
    const gl = context.gl;
    if (!this.atlasTexture) {
        this.atlasTexture = new Texture(context, this.atlasImage, gl.RGBA);   // no options → useMipmap undefined
    } else if (this.dirty) {
        this.atlasTexture.update(this.atlasImage);                            // no options → useMipmap undefined
        this.dirty = false;
    }
    this.atlasTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);                      // no minFilter arg
}
```

`Texture.update()`, `src/webgl/texture.ts:49-97`: `this.useMipmap =
Boolean(options?.useMipmap)` (line 61) — with no `options` object that's
`false`, so `gl.generateMipmap()` (line 90-92) never runs for this texture.

`Texture.bind()`, `src/webgl/texture.ts:119-144`: called with two args, so
`minFilter` is `undefined` and falls back to `filter || minFilter` = `filter`
(line 135). Both `TEXTURE_MAG_FILTER` and `TEXTURE_MIN_FILTER` are set to
`gl.LINEAR`. **There is exactly one mip level and it is sampled bilinear.**

This is not an oversight — MapLibre's own `Texture` class supports mipmaps and
even anisotropic filtering elsewhere in the same codebase, and deliberately
does not use them for the pattern atlas:

- `src/source/raster_tile_source.ts:201-204` — raster tiles: `new
  Texture(context, img, gl.RGBA, {useMipmap: true})` then `.bind(gl.LINEAR,
  gl.CLAMP_TO_EDGE, gl.LINEAR_MIPMAP_NEAREST)`.
- `src/webgl/context.ts:68,108` — `extTextureFilterAnisotropic =
  gl.getExtension('EXT_texture_filter_anisotropic')`, used elsewhere for
  raster/hillshade, not for `ImageManager`.

The reason is structural, not accidental: the pattern atlas packs many
different pattern images edge-to-edge (`_updatePatternAtlas`,
`image_manager.ts:300-329`, and `ImageAtlas` in `image_atlas.ts:74-118`) with
only 1px of wrapped padding per image. Auto-generating mips on that atlas
would blend each pattern's edge into its neighbour's at every level past the
first — this app's own `js/facades.js:72-74` comment states the identical
reason ("MapLibre samples the pattern atlas LINEAR with no mipmaps (atlases
cannot be mipmapped without bleeding between images)") and that statement is
now confirmed against the engine source, not just inferred.

## 2. How a pattern is scaled onto a fill-extrusion face

Neither metres nor screen pixels directly — **tile units, driven by camera
zoom, independent of the tile's own zoom.**

`patternUniformValues()`, `src/webgl/program/pattern.ts:44-63`:

```ts
const tileRatio = 1 / pixelsToTileUnits(tile, 1, painter.transform.tileZoom);
...
'u_scale': [tileRatio, crossfade.fromScale, crossfade.toScale],
```

`pixelsToTileUnits` is evaluated against `painter.transform.tileZoom` — the
**camera's** zoom — not the tile's own `overscaledZ`, so (as `facades.js:86-90`
already derived and this confirms) the tile's own zoom cancels out of the
final expression.

Vertex shader, `src/shaders/glsl/fill_extrusion_pattern.vertex.glsl:49-93`:

```glsl
float tileRatio = u_scale.x;          // = pixels→tile-units at camera zoom
...
vec2 display_size_a = (pattern_br_a - pattern_tl_a) / pixel_ratio_from;
...
v_pos_a = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower,
                           fromScale * display_size_a, tileRatio, pos);
```

`get_pattern_pos`, `src/shaders/glsl/_prelude.vertex.glsl:68-73`:

```glsl
vec2 offset = mod(mod(mod(pixel_coord_upper, pattern_size) * 256.0, pattern_size) * 256.0 + pixel_coord_lower, pattern_size);
return (tile_units_to_pixels * pos + offset) / pattern_size;
```

`pixel_ratio_from`/`pixel_ratio_to` are per-**feature** vertex attributes —
`src/data/bucket/pattern_attributes.ts:3-8`: `a_pixel_ratio_from` /
`a_pixel_ratio_to`, `Uint16`, one component each — exactly what
`js/facades.js:123-134` describes ("MapLibre carries it into the shader as a
VERTEX ATTRIBUTE ... Uint16"). `pixelRatio` is the value passed to
`map.addImage(key, data, {pixelRatio})`; the shader divides the atlas rect by
it to recover `display_size` in CSS-px-equivalent units. It has no other job —
it is not a filtering/sampling knob, only a display-size conversion.

Net effect: one pattern repeat covers `displaySize` CSS pixels of **screen**
at whatever the camera's zoom is, and the world size of that repeat in metres
is `displaySize * (metres-per-CSS-px at camera zoom)` — this app's own
`pattern-scale.mjs` finding ("resets at every integer zoom, 33.0 m at z16,
16.5 m at z17, 8.2 m at z18") and `js/facades.js:44-160`'s TIER_CSS mechanism
are both consistent with this source.

## 3. Where it aliases — what source gives us, and what it can't

Fragment shader, `src/shaders/glsl/fill_extrusion_pattern.fragment.glsl:30-36`:

```glsl
vec2 imagecoord = mod(v_pos_a, 1.0);
vec2 pos = mix(pattern_tl_a / u_texsize, pattern_br_a / u_texsize, imagecoord);
vec4 color1 = texture(u_image, pos);
```

A plain `texture()` call against a one-mip-level `LINEAR` sampler. GLSL's
automatic LOD selection from screen-space derivatives has nothing to select
from — there is only level 0 — so **any point where the projected texel
density exceeds one texel per screen pixel aliases immediately**, with no
graceful mip fallback. That's a hard, source-guaranteed threshold; contrast
with a mipmapped texture, which degrades gracefully well past that point.

What source alone gives us for "when" that threshold is crossed: at the
**design pose** (wall face-on, camera at the tier's calibration zoom), density
is exactly `tierPixelRatio(tier)` texels per CSS px by construction
(`js/facades.js:170-178`: `tierRes(t) / TIER_CSS`) — near tier ≈ 2 tex/CSS-px
at `devicePixelRatio` 1, far tier ≈ 1. That's the ONE ratio each tier's
prefilter (`soften` blur / `div` box-decimation, `facades.js:146-158`) was
calibrated against.

**What source cannot give us:** the *actual*, per-pixel, per-frame texel
density on a flying, pitched (up to ~74°) camera. `u_scale`/`tileRatio` is a
single 2D planar factor derived only from camera zoom (§2) — it carries no
term for a wall's distance from the camera, its facing angle relative to the
view direction, or pitch. The real screen-space minification of a 3D wall
varies continuously with all three through the ordinary perspective divide in
`u_projection_matrix * vec4(posInTile, elevation, 1.0)`
(`fill_extrusion_pattern.vertex.glsl:85`), and that variation is not visible
anywhere in the uniform math — it only exists after rasterization, in the
interpolated `v_pos_a`/`v_pos_b` and the derivatives GLSL computes per
fragment. Source cannot produce "aliases past zoom/pitch/altitude = X" as a
formula; that quantity only exists at render time.

This also explains, mechanistically, why the app's own two-tier system
(`js/facades.js`) does not close the defect even though its own comments
already name the same root cause: each tier's prefilter is tuned for ONE
nominal minification ratio at its calibration pose. A moving 3D camera sweeps
continuously through ratios the prefilter was never tuned for — grazing walls,
near/far buildings inside the same tile, pitch changes — and every one of
those poses re-exposes bare, un-prefiltered `LINEAR` sampling. A discrete
zoom-stepped tier can average out the defect's *density*; it cannot remove the
*mechanism*, because the mechanism is continuous and the tier switch is not.

## 4. Any styling lever to change the sampling?

**None found.** `ImageManager.bind()` hardcodes `gl.LINEAR` filtering and no
mipmap, unconditionally, for every pattern atlas — there is no
`pattern-resampling`, no per-image mipmap flag exposed through
`map.addImage()`'s options (`{pixelRatio, sdf}` are the only relevant ones),
and `sdf` is for icon/symbol rendering (signed-distance-field text/icons), an
entirely different render path — it does not apply to `fill-extrusion-pattern`
and would not change atlas filtering if it did. The raster-source contrast in
§1 shows the engine *has* the mechanism (mipmap + anisotropic); it is simply
never wired to patterns.

## Verdict

**CONSISTENT.** Every element of the hypothesis is directly confirmed in the
`v5.24.0` source: the atlas texture is created and bound with `LINEAR`
filtering and no mipmap generation (§1), the pattern is scaled by a single
camera-zoom-derived planar factor with no 3D/perspective awareness (§2), and
the fragment shader samples that one-level texture with a plain `texture()`
call that has no LOD to fall back to (§3) — so minification aliases with zero
tolerance, and the alias necessarily shifts as `v_pos_a`/`v_pos_b` shift with
view angle, i.e. exactly "windows crawl when the camera moves." No style-level
lever exists to opt out (§4).

**Not established — needs a runtime measurement, not source reading:**

1. The actual texel-density-vs-view-angle curve during the app's real flight
   paths — i.e., turning the qualitative mechanism in §3 into the "measured
   from the page" formula the brief asked for. This needs either (a)
   instrumenting the fragment shader to output `fwidth(v_pos_a)` as a debug
   channel and reading it back like `ground-luma.mjs` does, or (b) the
   indirect route: extend `shimmer-aba-prototype.mjs`'s A/B/A method with a
   sound (non-`renderScale`-confounded) flicker metric, sweep camera
   distance/pitch/bearing systematically, and correlate flicker onset against
   the `tierPixelRatio` formula in §3.
2. Whether a hand-rolled fix (pre-blurring the source drawing further, a
   finer zoom-stepped tier ladder, or fading pattern toward flat colour with
   distance — `docs/shimmer-brief.md` §5) actually reduces the measured
   flicker; source reading cannot settle that, only the meter in (1) can.
3. Whether WebGL2's `EXT_texture_filter_anisotropic` or a per-tile (not
   atlas-wide) mipmap could be retrofitted onto patterns without engine
   changes — not investigated here; §1 only establishes that the *shipped*
   `ImageManager` path does not do this today.
