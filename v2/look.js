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
  // a local reflection probe (exact-pilot.js) sees the sky at the mirror's scale (LIGHT_B.mirror), as the environment map does; false = the
  // visible dome's scale (the pilot's first probe, 1.6x darker sky in its glass than the Blender rig's mirrors). ?probemirror=0 = false
  PROBE_MIRROR_SKY: true,
  SKY_DOME_GAIN: 1.0,           // the visible sky (and the fog, which is its horizon) = the stops x this, then tone mapped like the city
  SUN_AZIMUTH_DEG: 215,         // compass bearing the light COMES FROM (215 = south-west, afternoon)
  SUN_ELEVATION_DEG: 48,

  // ── the sky of a moment (v2/sky.js; ONLY with ?moment=..., the default above is unchanged) ──
  // ?moment=2026-10-24T17:07 (Austin's clock) or ?moment=IMG_1778 (a preset in v2/data/moments.json); &haze= &cover= &exposure= override.
  MOMENT: {
    REF: { AZ: 215, EL: 48, HAZE: 1 },   // the calibration: at this sun and haze, with no clouds, the model's sky and sun ARE Light B's
    HAZE: 1,                     // aerosols, 1 = optical depth 0.1 at 550 nm
    MULTI_SCATTER: 0.0,          // share of the sky's mean added for light scattered more than once (0 = single scattering)
    SKY_GLOW: 0.25,              // the sun's halo in the visible dome (as SKY_SUN_GLOW)
    // the cloud layer: a plane at ALT_M, features SIZE_M across, COVER = the share of the sky covered (0 = clear), SOFT = edge softness
    // in noise units, lit by the moment's sun (SUN, SILVER = forward-scattering halo toward the sun, G its sharpness) and sky (AMBIENT),
    // BASE_DARK = how much darker the thick parts are; HORIZON: the sines over which clouds fade into the haze near the horizon
    CLOUDS: { ALT_M: 1800, SIZE_M: 1100, COVER: 0, SOFT: 0.1, OCTAVES: 6, OFFSET: [0, 0], MIN_SIN: 0.03, HORIZON: [0.01, 0.07],
              SUN: 0.55, SILVER: 2.5, G: 0.6, AMBIENT: 0.9, BASE_DARK: 0.45, OPACITY: 1.0 },
    // after dusk: what single scattering leaves out (airglow + the city's light on the haze), dome units, faded in as the sun sinks
    // from FROM_EL[1] to FROM_EL[0] degrees; GLOW falls off with the sine of the height as e^(-sine / GLOW_SINE)
    // (a night photo is exposed ~10^4 x a day one: IMG_1855 1/9 s ISO 800 vs IMG_1778 1/7143 s ISO 64, so these are tiny in day units)
    NIGHT: { FROM_EL: [-8, -2], ZENITH: [2e-6, 3e-6, 8e-6], GLOW: [2.5e-5, 1.6e-5, 1.0e-5], GLOW_SINE: 0.12,
             // lit windows (first pass): radiance in the same units, the share of windows lit, and the Blender glass's cell (storey, bay, m)
             WINDOWS: [2.0e-4, 1.5e-4, 0.9e-4], LIT_SHARE: 0.45, CELL_M: [3.3, 3.0] },
    GROUND_SHADE: true,          // the ground a face looks at, in the shadow of the sun, gives no sun bounce (PR #550 cause 4)
    GROUND_ALBEDO: 0.32,         // = LIGHT_B.ground
    GROUND_MAX_M: 600,           // ...the ground point looked at is at most this far from the face
    GROUND_TAPS: 5,              // ...shadow taps per face: 1 along the look, the rest on a ring GROUND_SPREAD around it (1 = one tap)
    GROUND_SPREAD: 1.0,          // (1.0 = 45 degrees off the look)
    MIN_LIGHT_EL: 2,             // the sun light's direction (for its shadows) stays this many degrees up after sunset; its strength is 0
    // a real captured sky (v2/sky-real.js, ?sky=NAME or a moment's "sky"): FOG_SINE = the height (sine) at which the haze colour is read
    // all round; DISC_GLOW = the app's sun disc drawn on it (the HDRI keeps its own halo; its disc is painted out by sky_bake.py)
    // LIGHT_SAT: x Light B's own sky -> light saturation (main.js lightDesat); 1 = exactly Light B's relation
    // FIT_SLOPE_MAX: the most the colour fit of a library sky to his photo may change per radian of height (log units)
    REAL: { FOG_SINE: 0.02, DISC_GLOW: 0.25, LIGHT_SAT: 1, FIT_SLOPE_MAX: 3 },
  },

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
  // ...and centred on what the middle of the view looks at: the first building or ground the view's centre ray meets within MAX_M
  // (main.js shadowFocus) when that lies FARTHER than the flycam's focus (aerials looking down keep their box as before). Without it a street-level view of a tower left the tower outside the
  // box: no sun shadow on it at all (2026-10-25, the owner's photo IMG_1778). ?shadowaim=0 = off.
  SHADOW_AIM: { ON: true, START_M: 2, STEP_M: 2, STEP_GROW: 0.04, MAX_M: 3000, TOP_M: 350 },   // TOP_M: above every building top
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
  // Slope-scaled depth offset of the Blender models in the shadow map (glPolygonOffset factor; 0 = off). The models are drawn double-sided
  // (their faces are wound either way, tiles.js), so a lit face also stands in the map and is compared with ITSELF; a narrow lit part (a
  // band, a sill, a pillar) shares its shadow texels with its own top and sides and fell in its own shadow in diagonal stripes ("acne":
  // Jester's cream bands drawn as grey streaks, porch pillars striped as if see-through, 2026-10-20). 4 clears every view tried down to
  // the 0.35 m texel of a 720 m shadow box; 2 still streaks. ?light=old = 0.
  SHADOW_SLOPE_BIAS: 4,

  // ── ambient occlusion of the Blender models (baked per vertex by scripts/v2/ao_bake.mjs, attribute _AO) ──
  // It multiplies the INDIRECT light only (the sky and the ground's bounce, and what glass mirrors); the sun is the shadow map's.
  // Recesses, reveals, the inside of loggias and arcades, the joints of pilasters and cornices get their contact darkening. Baked into
  // the geometry, so it is the same in every frame (rule 15). ?ao=0 or ?light=old = off.
  // FAR_PX_M: from the 1st to the 2nd size of a pixel on the surface (metres), the AO of each face gives way to the far AO (_AO's second value:
  // the same AO box-filtered over 3 m); from the 3rd to the 4th the AO fades out. Per-face AO on fins and slots finer than a pixel
  // flickered in motion (DKR fins at 1800 m: shimmer 0.63 without AO, 0.80 with it; 0.75 with the far AO alone; rule 15).
  AO: { ON: true, STRENGTH: 1.0, FAR_PX_M: [0.06, 0.18, 0.35, 0.9] },

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

// ?light=old shows the light as it was before 2026-10-20 (no baked AO, no shadow slope offset), for a before/after in one app.
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const LIGHT_OLD = Q.get('light') === 'old';
if (LIGHT_OLD) { LOOK.SHADOW_SLOPE_BIAS = 0; LOOK.AO.ON = false; }
if (Q.get('ao') === '0') LOOK.AO.ON = false;
if (Q.get('shadowaim') === '0') LOOK.SHADOW_AIM.ON = false;
if (Q.get('probemirror') === '0') LOOK.PROBE_MIRROR_SKY = false;
if (Q.get('ao') && Q.get('ao') !== '0') LOOK.AO.STRENGTH = +Q.get('ao');
if (Q.get('aofar')) LOOK.AO.FAR_PX_M = Q.get('aofar').split(',').map(Number);   // e.g. ?aofar=0.06,0.18,0.35,0.9

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
