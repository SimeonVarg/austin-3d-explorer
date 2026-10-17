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
  TONE_MAPPING: 'neutral',      // 'agx' | 'aces' | 'neutral' | 'none' (neutral = Khronos PBR Neutral: base colours stay true, highlights roll off)
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
  SHADOW_MAP_SIZE: 2048,        // desktop
  SHADOW_MAP_SIZE_PHONE: 1024,
  SHADOW_EXTENT_M: 450,         // half-width of the square the sun's shadow covers, centred on the camera target
  SHADOW_STEP_TEXELS: 32,       // the shadow box moves in whole steps of this many shadow texels: it never slides, so it never shimmers
  SHADOW_BIAS: -0.0004,
  SHADOW_NORMAL_BIAS: 0.6,
  SHADOW_RADIUS: 2,             // PCF softness

  // ── fog / distance ───────────────────────────────────────────────────
  // the fog's colour is the sky's horizon stop (x SKY_DOME_GAIN), so far buildings fade into the sky they stand against
  FOG_NEAR_M: 1800,
  FOG_FAR_M: 7000,

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
  BUILDING_WALL: '#7d7a73',     // linear ~0.20: a little above the builders' white paint, so the plain city reads pale
  BUILDING_ROOF: '#6f6c66',
  BUILDING_TINT: 0.25,          // how much of the surveyed wall / roof HUE each extrusion takes (its brightness stays the plain one)
  BUILDING_ROUGHNESS: 0.92,

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
};
