// EVERY taste value of v2 lives here (repo rule 11). Change a line, reload, compare.
// Colours are sRGB hex as you would pick them; three.js converts them to linear for the light maths.
//
// The light is the old app's (js/city-sky.js) under "Light B" (owner, 2026-10-15): sky light x1.5, ground bounce x2 (0.32), sun
// x0.84, a separate brighter sky (x1.6) for what glass mirrors. In v2 the sky light is a PMREM environment made from SKY_STOPS x
// SKY_GAIN x LIGHT_B.sky, the bounce is its lower half, the sun is one DirectionalLight, and glass gets its own mirror environment.

export const LOOK = {
  // ── tone and exposure ────────────────────────────────────────────────
  // The light below is in the old app's absolute units (a sun of ~20), in which the builders' standard WHITE PAINT has an albedo of
  // 0.17 (js/city-sky.js, the soft light's note). Every colour in this file is picked on that scale, so the Blender models and the
  // plain city sit under the same light at exposure 1.
  // 'none' = Blender's "Standard" view, which the Blender renders (and the old app's light, js/city-sky.js csDisplay) use: exposure,
  // then the sRGB curve, nothing else. NOT 'neutral': Khronos PBR Neutral subtracts the darkest channel from dark colours (up to
  // 0.04 linear), which took the red out of every shaded surface: shade under the blue sky came out navy, (34, 64, 96) on pale
  // concrete where the Blender render of the same light gives a grey-blue. Other choices: 'agx' | 'aces' | 'neutral'.
  // 'standard' = the same, with a soft shoulder above TONE_SHOULDER (linear) so sunlit whites roll off instead of clipping flat.
  TONE_MAPPING: 'standard',
  TONE_SHOULDER: 0.8,
  EXPOSURE: 1.0,

  // ── the light: the old app's day sky and Light B, in the same units (js/city-sky.js, TUNE.day / skyGain / sunStrength / LIGHTS.b) ──
  // The sky by the sine of the height above the level line: [sine, sRGB 0..255]. The first entry is the far land, the second the horizon.
  SKY_STOPS: [[-0.02, [108, 128, 138]], [0.004, [108, 128, 138]], [0.006, [190, 210, 226]], [0.045, [181, 203, 222]],
              [0.153, [119, 170, 224]], [0.26, [88, 139, 202]], [0.6, [55, 100, 180]]],
  SKY_GAIN: [6.226, 4.002, 2.449],  // what the sky is multiplied by when it LIGHTS a surface (the Blender scene's own gain)
  LIGHT_B: { sky: 1.5, ground: 0.32, sun: 0.84, mirror: 1.6 },   // owner, 2026-10-15: "B definitely"
  SUN_STRENGTH: [23.65, 21.64, 18.95],   // linear, measured on site photographs (before LIGHT_B.sun)
  GROUND_MIRROR: [0.024, 0.041, 0.058],  // what glass sees below the level line
  SKY_SUN_GLOW: 0.25,           // the sun's halo in the visible sky dome
  SKY_DOME_GAIN: 1.0,           // the visible sky (and the fog, which is its horizon) = the stops x this, then tone mapped like the city
  SUN_AZIMUTH_DEG: 215,         // compass bearing the light COMES FROM (215 = south-west, afternoon)
  SUN_ELEVATION_DEG: 48,

  // ── hemisphere fill (off by default: the environment carries sky and bounce) ──
  HEMI_SKY: '#dfe9f5',
  HEMI_GROUND: '#b8ae98',
  HEMI_INTENSITY: 0.0,

  // ── shadows ──────────────────────────────────────────────────────────
  SHADOW_MAP_SIZE: 4096,        // desktop
  SHADOW_MAP_SIZE_PHONE: 2048,
  // The square the sun's shadow covers is fitted to the view: half-width = FIT x the camera's distance to its target, rounded to the
  // nearest of a fixed ladder (MIN x STEP^k, up to MAX), so a shadow texel stays about the same size ON SCREEN at every distance
  // (close views get fine, clean edges; the opening view still has shadows to its horizon). The ladder means the texel size only
  // changes in whole steps, with HYSTERESIS, never continuously: a zoom changes it once, a pan or a turn never does.
  SHADOW_FIT: 0.8,
  SHADOW_EXTENT_MIN_M: 90,
  SHADOW_EXTENT_MAX_M: 1100,
  SHADOW_EXTENT_STEP: Math.SQRT2,
  SHADOW_EXTENT_HYSTERESIS: 0.2,
  SHADOW_STEP_TEXELS: 32,       // the shadow box moves in whole steps of this many shadow texels: it never slides, so it never shimmers
  SHADOW_STEP_TEXELS_MOVING: 32, // the same in motion (a multiple of SHADOW_STEP_TEXELS; bigger = fewer shadow redraws while moving)
  SHADOW_BIAS_M: 0.08,          // depth bias in metres along the sun (converted to the shadow camera's depth range)
  SHADOW_NORMAL_BIAS_TEXELS: 1.2,   // normal offset in shadow texels (so it shrinks with the texel: no light leaking under thin parts)
  SHADOW_RADIUS: 1.25,          // PCF softness, in texels
  SHADOW_VIEW_CULL_MARGIN_TEXELS: 8,   // a caster is kept in the shadow map if its shadow comes within this many texels of the view

  // ── haze / distance ──────────────────────────────────────────────────
  // The old app's day haze (js/sky.js HAZE: DIST.day 3200, MAX.day 0.62): a surface d metres away is MAX x (1 - e^(-d/DIST)) of
  // the way to the haze colour. The haze colour is the sky's horizon stop (x SKY_DOME_GAIN), so far buildings fade into the sky
  // they stand against. Beyond the city (HAZE_EDGE_M) the haze closes to 1, so the bare ground's far edge melts into the
  // horizon, and the sky dome below the level line is that same haze colour: no band where the ground ends.
  HAZE_DIST_M: 3200,
  HAZE_MAX: 0.62,
  HAZE_EDGE_M: [8000, 15000],

  // ── ground ───────────────────────────────────────────────────────────
  GROUND: '#5c5a52',            // pavement and bare ground, linear ~0.10
  ROAD: { motorway: '#38393b', trunk: '#3a3b3d', primary: '#3c3d3f', secondary: '#3e3f41', tertiary: '#404143',
          residential: '#424345', service: '#48494a', unclassified: '#424345', living_street: '#4a4a49', default: '#414244' },
  ROAD_WIDTH_SCALE: 1.0,        // the data's widths are kerb-to-kerb metres
  CYCLE: '#4f4b45',
  CYCLE_WIDTH_M: 1.6,
  SIDEWALK: '#76726a',
  SIDEWALK_WIDTH_M: 2.2,

  // ── plain buildings (the extrusions the Blender models replace) ─────
  // linear ~0.15 / ~0.12: under the Standard view (#512) the old 0.20 / 0.16 (#7d7a73 / #6f6c66, picked under Neutral's highlight
  // compression) washed sunlit walls out to near white; these sit just under the builders' white paint (0.17), as a plain wall should
  BUILDING_WALL: '#6c6a65',
  BUILDING_ROOF: '#615f5a',
  BUILDING_TINT: 0.25,          // how much of the surveyed wall / roof HUE each extrusion takes (its brightness stays the plain one)
  BUILDING_ROUGHNESS: 0.92,

  // ── facades on the plain buildings (the old app's look: windows, storeys) ──
  // Windows are drawn in the shader from each wall's [bay, storey] coordinates (city-worker.js). They are FILTERED, not faded:
  // each window's coverage is averaged exactly over the pixel's footprint on the wall (a box filter, from the screen derivatives),
  // so close up a window is a sharp rectangle and far away a wall becomes its true average of glass and wall, with nothing in
  // between that can flicker in motion (rule 15). Past FADE_PX the remaining ripple is faded to that average.
  FACADE: {
    ON: true,
    BAY_M: 3.4,                 // window bay width (a wall gets round(length / BAY_M) equal bays)
    MIN_WALL_M: 2.2,            // shorter walls (curved outlines' small steps) get no windows
    MIN_HEIGHT_M: 5,            // shorter buildings (sheds, canopies) get none
    // by the building's height: [height up to (m), storey height (m), window width (share of the bay, centred),
    // window height (share of the storey), sill (share of the storey)]: houses, mid-rises, towers (towers read as ribbon glazing)
    STOREYS: [[13, 3.2, 0.42, 0.45, 0.32], [40, 3.4, 0.55, 0.5, 0.3], [1e9, 3.8, 0.8, 0.62, 0.22]],
    GLASS: '#28323c',           // window glass (linear ~0.02): dark, the sky's mirror adds the rest
    GLASS_ROUGHNESS: 0.25,
    BAND: 0.07,                 // a slab line at each floor, share of the storey (0 = none)
    BAND_SHADE: 0.82,           // the slab line's colour = the wall x this
    FADE_PX: [0.22, 0.45],      // footprint (bays or storeys per pixel) over which the pattern fades to its average: gone before a bay is 2 px
  },

  // ── trees ────────────────────────────────────────────────────────────
  TREE_CROWN: '#33482a',
  TREE_CROWN_VARIATION: 0.12,   // random lightness spread per tree
  TREE_TRUNK: '#3a3027',
  TREE_CROWN_SHARE: 0.62,       // share of the tree height that is crown

  // ── the walking route ────────────────────────────────────────────────
  ROUTE: '#e0592a',
  ROUTE_WIDTH_M: 5,
  ROUTE_LIFT_M: 0.0,            // the route draws after the ground layers (render order), so it needs no lift
  DOOR_START: '#1f6fd6',
  DOOR_END: '#e0592a',
};

// Speed knobs that change the picture (kept here so a phone/desktop difference is visible in one file).
export const QUALITY = {
  MAX_PIXEL_RATIO: 2,           // desktop
  MAX_PIXEL_RATIO_PHONE: 2,
  MSAA: true,
  // The sun's shadow map is drawn again only when it can change: the light box moved a step, or a shadow caster was added,
  // removed, shown, hidden or reshaped (main.js casterSignature). Same picture; ?shadowcache=0 redraws it on every frame.
  SHADOW_CACHE: true,
  // ...and holds only the casters whose shadow can reach the view (main.js cullCasters; conservative). ?shadowcull=0 keeps all.
  SHADOW_VIEW_CULL: true,
  // Adaptive resolution, IN MOTION ONLY: while the camera moves and the measured frame time stays above the target, the canvas
  // draws fewer pixels (the browser scales it up); the moment the camera stops it is back at full sharpness. A GPU that holds the
  // target never leaves full resolution. ?adapt=0 turns it off; ?adaptfps=N sets the target.
  ADAPT: {
    ON: true,
    TARGET_FPS: 30,             // the floor it defends in motion
    DOWN_AT: 1.2,               // step down when the median motion frame is slower than this x the target's frame time
    UP_AT: 0.6,                 // step back up in motion when the median frame is faster than this x the target's frame time
    STEP: 0.84,                 // one step = this x the linear scale (about 0.7 x the pixels)
    // a step down must make the median frame this much faster, or it is undone (0 = off). OFF: measured 2026-10-19 in the opening
    // flight on the Mac, the view changes too fast for two windows to compare, and it undid steps that helped (66.6 -> 83.4 ms)
    MIN_GAIN: 0,
    RELEARN_MS: 8000,           // ...and not tried again for this long
    MIN_SCALE: 0.5,             // never below this x the full pixel ratio (linear)
    MIN_PIXEL_RATIO: 1,         // and never below one canvas pixel per CSS pixel
    WINDOW: 5,                  // motion frames measured after a change before the next decision (their median)
    STILL_MS: 200,              // the camera has not moved for this long: draw at full resolution again
  },
};
