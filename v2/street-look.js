// Taste and speed values of the v2 street layers (the aerial ground, street furniture, trees). Repo rule 11: change a line, reload.
// Kept apart from look.js so the street lane and the look lane never edit the same file.

export const GROUND_LOOK = {
  // ── the aerial (City of Austin, 2025, 6 inch) ───────────────────────
  ON: true,                     // ?aerial=0 turns it off for an A/B
  // The photograph's colours are what the camera saw under a January sky; v2 lights them again (sun, sky, shadows), so they go in as
  // albedo: linear colour x GAIN. In v2 units the builders' white paint is albedo 0.17 (look.js), so a photograph white (~0.6 linear)
  // must land near 0.2: GAIN ~0.34 (0.48 and 0.62 were tried 2026-10-18 and read as washed-out white pavement at street level).
  GAIN: 0.34,
  SATURATION: 0.92,             // 1 = as photographed
  SATURATION_NEAR: 0.45,        // where one photograph pixel covers 8 or more screen pixels (street level): hides the JPEG colour fringes
  TINT: [1.0, 0.99, 0.96],      // a slight warm shift toward v2's afternoon light (linear multipliers)
  // The January shadows baked into the photograph (shadow.png, from the buildings' heights and the photograph's own sun): where the
  // mask says shadow AND the pixel is dark, the pixel is lifted by up to SHADOW_LIFT and its sky-blue cast taken out.
  SHADOW_LIFT: 2.6,
  SHADOW_WARM: [1.12, 1.0, 0.86],
  SHADOW_DARK_LIN: [0.02, 0.09], // linear luminance: fully lifted below the first, not at all above the second
  // Leaning roofs: the photograph is not a true ortho, so a tall roof is drawn beside its footprint. Round tall buildings the ground
  // fades toward this plain paving colour (mask channel G).
  LEAN_PAVING: '#55534d',       // the plain paving the ground fades to under and round a leaning building (linear ~0.09, the aerial's pavement after GAIN)
  LEAN_STRENGTH: 0.92,

  // ── streaming (not taste: what keeps it sharp and fast) ───────────────
  LOD_FACTOR: 1.6,              // a tile is split when its pixel is bigger than this many screen pixels at its nearest point
  LOD_FACTOR_PHONE: 2.2,
  MAX_ZOOM: 20,                 // z20 = 0.13 m a pixel here, the photograph's own resolution
  MAX_ZOOM_PHONE: 19,
  MAX_TILES: 150,               // drawn at once; above this the LOD factor is raised for that frame
  CACHE_TILES: 420,             // kept on the graphics card (about 350 KB each with mipmaps)
  CACHE_TILES_PHONE: 200,
  LIVE_CONCURRENCY: 6,
  LOCAL_CONCURRENCY: 6,
  UPLOADS_PER_FRAME: 6,
  LIVE_FAILS_TO_PAUSE: 8,       // this many City failures in a row pause live tiles for LIVE_PAUSE_MS (the baked levels stay)
  LIVE_PAUSE_MS: 60000,
  ANISOTROPY: 16,               // capped by the graphics card
  HIDE_RIBBONS: true,           // the photograph has the real roads and paths, so the drawn road/sidewalk bands go once it is in
};

export const STREET_LOOK = {
  // ── fades (rule 15: thin things go before they get thinner than a pixel; the aerial carries the same paint beyond) ──
  FADE: { flat: [260, 380], up: [320, 520] },          // metres from the camera: [full, gone]
  FADE_PHONE: { flat: [200, 300], up: [240, 400] },
  // ── paint and curbs ──
  PAINT: '#a9a8a2',             // road paint as albedo on v2's scale (white paint 0.17 is the builders' wall white; paint reads a step brighter)
  PAINT_LIFT_M: 0.02,
  CURB: '#8f8c84',
  CURB_HEIGHT_M: 0.15,
  CURB_TOP_M: 0.3,
  PAD: '#7b3a2c',               // the City's ramps record brick-red or metal warning pads
  PAD_M: [1.2, 0.6],
  // ── signals ──
  SIGNAL_METAL: '#4a4c4d',
  SIGNAL_HEAD: '#1d1e1f',
  SIGNAL_POLE_M: 6.4,
  FOOTING: '#8a877f',
  SIGNAL_ARM_Y_M: 6.0,
  SIGNAL_HEAD_H_M: 1.1,
  SIGNAL_HEAD_W_M: 0.36,
  SIGNAL_HEAD_D_M: 0.26,
  SIGNAL_HANGER_M: 0.10,
  SIGNAL_LENS_R_M: 0.1524,       // 12-inch indication, FHWA MUTCD 4D.07
  SIGNAL_LENS_STEP_M: 0.35,
  SIGNAL_LENS_COLORS: ['#501b15', '#54421a', '#173e2b'], // unlit lenses; phase is unknown
  SIGNAL_HEADS_AT: [0.55, 0.92],   // along the mast arm
  // ── lamps ──
  LAMP_METAL: '#3e4143',
  LAMP_HEAD: '#55595c',
  LAMP_MAST_M: 9.0,
  LANTERN_POST_M: 4.0,
  LANTERN_GLASS: '#d9d2bd',
  // ── bus stops and benches ──
  SHELTER_ROOF: '#5b6066',
  SHELTER_GLASS: '#8fa3ad',
  SHELTER_FRAME: '#3e4246',
  BENCH: '#4a4d4f',
  STOP_FLAG: '#c8c7c2',
};

export const TREE_LOOK = {
  // v2's own tree look (look.js TREE_*: crown '#33482a', +-12 % lightness, crown = 62 % of the height), kept, with a colour and a shape
  // per species group. radius = x the baked crown radius; minAspect = the crown is at least this x radius tall.
  GROUPS: {
    oak:       { shape: 'round', color: '#33482a', radius: 1.15, crownShare: 0.62, minAspect: 1.1 },   // live oaks: broad, dark
    broadleaf: { shape: 'round', color: '#3d5530', radius: 1.1, crownShare: 0.66, minAspect: 1.3 },    // elms, pecans, ashes
    small:     { shape: 'round', color: '#4a5d34', radius: 1.0, crownShare: 0.7, minAspect: 1.4 },     // crape myrtle, redbud, yaupon
    conifer:   { shape: 'cone', color: '#2c3d2a', radius: 1.0, crownShare: 0.85, minAspect: 2.2 },     // cedars, cypress
    palm:      { shape: 'round', color: '#4f6436', radius: 0.9, crownShare: 0.22, minAspect: 0.6 },
  },
  LIGHTNESS_VARIATION: 0.12,
  HUE_VARIATION: 0.02,
  TRUNK: '#3a3027',
};

// ?trees=real (v2/trees-real.js): a library of Austin tree forms (EZ-Tree, MIT) drawn in three distance bands. Colours come from the
// owner's photographs (data/trees-real/manifest.json: median of masked leaf and trunk pixels); GAIN turns a photograph's colour into
// v2's albedo scale (the aerial's GROUND_LOOK.GAIN does the same for pavement, 0.34). Repo rule 11: change a line, reload.
export const TREE_REAL_LOOK = {
  // distance bands in metres from the camera: [centre of the near -> mid crossfade, half-width of it], same for mid -> far
  NEAR_TO_MID_M: [62, 7], MID_TO_FAR_M: [190, 22],
  NEAR_TO_MID_M_PHONE: [35, 9], MID_TO_FAR_M_PHONE: [130, 30],
  LEAF_LIT_MIX: 0.45,           // 0 = the photograph's middle leaf colour, 1 = its lit leaves
  LEAF_SAT: 1.5,                // x saturation
  LEAF_GAIN: 0.62,             // x the photograph's lit-leaf colour (linear): the app's sun and sky then light it
  TRUNK_GAIN: 0.4,
  LEAF_ROUGHNESS: 0.92,
  SPECULAR: 0.1,                // the leaf and bark specular (three: 1 = the default 4 % mirror; sky-lit dark leaves went silver at 1)
  ALPHA_LOD: [1.0, 3.0],        // log2(texels per pixel) over which the sharpened alpha edge gives way to plain coverage (no flicker, rule 15)
  ALPHA_LOD_FAR: [-0.5, 1.0],   // the same for the far crowns' atlas (96 px a view): plain coverage from about one texel a pixel
  MID_CARD_DOWN: 2,             // the mid cards' texture is the card shrunk this many times (leaf shapes merged into soft clumps)
  IMPOSTOR_MIN_LOD: 1.0,        // the far crowns never sample the atlas finer than this mip (log2): the detail is under a pixel there
  ALPHA_CUT: 0.5,              // alpha test (smoothstep over the pixel's own alpha slope when MSAA is on: alpha to coverage)
  SHADE_JITTER: 0.14,           // +- brightness per tree (from the inventory's shade byte)
  CROWN_STRETCH: [0.78, 1.38],  // the model's crown width may stretch to the inventory's crown radius by this much (x)
  IMPOSTOR_UP_NORMAL: 0.6,      // how far the far crowns' lighting normal leans toward the sky (0 = faces the camera), when IMPOSTOR_SPHERE < 1
  IMPOSTOR_SPHERE: 1,           // the far crowns lit with their crown's sphere normals, as the mid cards are (1), or the flat normal above (0)
  IMPOSTOR_SHADOW: true,        // the far crowns take the sun's shadow (looked up on their crown's sphere), as the mid cards do
  IMPOSTOR_UP_BIAS: 0.28,      // the mid cards' normals lean up by this (tools/trees: outward + 0.28 up); the far crowns copy it
  FAR_VARIANTS: 2,
  TRIM_CARDS: true,             // each leaf card cut to the octagon around everything its texture can draw (speed only, the same picture)
  TRIM_LEVELS: 4,               // ...over mip levels 0..this (deeper levels: a card a few pixels wide, where fill costs nothing)
  GRID_M: 64,                  // the per-frame update finds the near and mid trees through squares this size (speed only, no look)
  FRUSTUM_MARGIN: 0.16,       // a tree this many radians outside the view is still drawn (a quick turn does not show holes)
  RECEIVE_SHADOW: true,         // the cards and trunks take the sun's shadow (?treeshadow=0 turns it off for a test)
  SHADOW_PROXY: true,           // one 20-triangle crown per tree casts the sun's shadow (the cards and impostors cast none)
  SHADOW_PROXY_SHRINK: 0.8,
};

export const NEAR_LOOK = {
  // ── street level near the camera (street_near.js) ──
  FADE: [60, 90],               // metres from the camera: modelled street fully in / gone (the aerial carries the rest)
  FADE_PHONE: [50, 75],
  MAX_CAMERA_Y_M: 140,          // above this the near layer is not drawn at all
  ASPHALT: '#3d3e40',           // albedo on v2's scale (the old road ribbons' tone)
  ASPHALT_GRAIN: 0.09,          // +- share of brightness, two octaves, faded below a pixel (0.18 read as clouds at eye level)
  ASPHALT_Y_M: 0.008,
  PAINT_WHITE: '#a9a8a2',
  PAINT_YELLOW: '#a8892e',
  PAINT_Y_M: 0.014,
  LANE_W_M: 0.12,
  DASH_M: [3.0, 9.0],           // Austin's 10 ft dash, 30 ft gap
  GUTTER: '#7d7a72',
  GUTTER_M: 0.45,
  GUTTER_Y_M: 0.011,
  CURB: '#8f8c84',
  CURB_HEIGHT_M: 0.15,
  CURB_TOP_M: 0.15,
  CURB_TOP_LIFT_M: 0.002,       // separate top trim from slab depth; no coplanar surfaces
  WALK: '#86837b',
  CONCRETE_GRAIN: 0.08,
  JOINT_M: 1.52,                // 5 ft slabs
  JOINT_DARK: 0.35,
  SIGN_POST: '#8b8d8f',
  SIGN_POST_M: 3.1,
  SIGN_POST_R_M: 0.045,         // 0.03 read as a hairline from 8 m up
  FRONT_Y_M: 0.004,           // aerial-classified ground is ground; only surveyed sidewalks have a 15 cm step
  FRONT_PAVING: '#837f76',      // the right-of-way past the sidewalk: plaza and frontage paving, ...
  FRONT_LAWN: '#4b5733',        // ... lawn and planting strips, ...
  FRONT_MULCH: '#4d4034',       // ... mulch and bare soil (classes read off the aerial per 3 m: street_near.py)
  LAWN_GRAIN: 0.12,
  SIGN_INK_OFFSET_M: 0.075,
  SIGN_BORDER_INSET: 0.94,
  SIGN_YIELD_TEXT_HEIGHT: 0.35,
  SIGN_BLADE_GAP_M: 0.18,
  SIGN_BORDER_M: 0.012,
  SIGN_YIELD_BORDER_M: 0.06,
  SIGN_TEXT_FILL: 0.77,
  SIGN_LINE_SPACING: 1.2,
  SIGN_INK: '#17191b',
  SIGN_WHITE: '#d5d4cf',
  SIGN_RED: '#8e1d1b',
  SIGN_YIELD_TEXT_FILL: 0.48,
  SIGN_YIELD_TEXT_RISE: 0.18,
  SIGN_CLEARANCE_M: 2.1,
  SIGN_STACK_GAP_M: 0.08,
  SIGN_TOP_M: 2.75,             // the top panel's top edge
  SIGN_BLADE_Y_M: 3.05,         // street-name blades sit on top of the post
  SIGNS: {                      // by kind (street_near.py): w x h metres, colour, shape
    0: { w: 0.3, h: 0.45, color: '#c8c7c2', shape: 'rect' },
    1: { w: 0.75, h: 0.75, color: '#8e1d1b', shape: 'octagon' },
    2: { w: 0.9, h: 0.15, color: '#1f5a36', shape: 'rect' },
    3: { w: 0.9, h: 0.78, color: '#c8c7c2', shape: 'triangle' },
    4: { w: 0.75, h: 0.75, color: '#c9a425', shape: 'diamond' },
    5: { w: 0.6, h: 0.75, color: '#c8c7c2', shape: 'rect' },
  },
};

// ?sidewalk=0 turns this off (the old cream slab 0.15 m above the buildings' base). Owner photos IMG_0741/0742 (Hogg) and the campus
// walk photos: sidewalks are mid-grey concrete with darker joints and a darker, dirtier curb, and the walk meets a building's base
// level with it. v2's ground is flat at y = 0 and every building stands on y = 0, so y = 0 is the sidewalk's grade: the street
// (asphalt, gutters, paint, arrows) sits one curb height BELOW it, as in the photographs, instead of the walk sitting above the base.
// Colours: albedo on v2's scale, from the owner's photo IMG_0742 drawn from its solved camera under the matched sky (exposure 9.7,
// wb 1.11,0.81; scripts/verify/v2-exact.mjs). Under that sky the app's whole frame renders ~1.4-1.6x the photo's linear light
// (limestone 1.4x, asphalt 1.6x), so the concrete is fitted RELATIVE to the asphalt drawn in the same frame: his concrete apron is
// 0.85-0.95x the parking lot's luminance, warmer (photo sRGB 126,118,111 vs 128,138,146); his curb is ~0.35x the concrete's light
// (a dark, dirty face). The old walk (#86837b) and frontage paving (#837f76) were ~5x the asphalt's albedo, brighter than the
// builders' white paint (0.17), and clipped to cream under every exposure that gets the buildings right.
export const SIDEWALK_LOOK = {
  ON: true,
  ROAD_DROP_M: 0.15,            // the street below grade = the curb's real height (Austin standard 6 in)
  WALK: '#3c362f',              // broom-finished concrete: renders 0.85x the lot's light in IMG_0742's frame (photo 0.83x), the photo's warm hue
  WALK_GRAIN: 0.06,             // +- share of brightness, faded below a pixel
  JOINT_M: 1.52,                // 5 ft slabs, joints across the walk's long axis
  JOINT_DARK: 0.4,              // a joint line's darkening at full strength
  JOINT_HALF_M: 0.012,          // the joint's half width (a tooled joint is ~2.5 cm across)
  JOINT_FADE_PX: [16, 6],       // screen pixels per slab where the joints start to fade / are gone (rule 15: no shimmer, not blur)
  CURB: '#2e2c2a',              // curb top and face: older, dirtier concrete; the face renders ~0.5x the lot in IMG_0742 (photo 0.41x, a dirty face) without going black in sun
  GUTTER: '#34302b',            // the concrete gutter pan beside the curb
  FRONT_PAVING: '#3b362f',      // plaza and frontage paving between walk and building (the old #837f76 drew the cream band)
  FRONTAGE_AT_GRADE: true,      // paving, lawn and mulch between walk and building sit at the walk's level (the building's base)
};

// ?groundnear=0 turns this off. The ground near the camera (v2/ground-near.js): instead of the aerial photograph (blurred white
// smears, painted-on cars and shadows at street level) the ground is drawn as five surfaces from the repo's own inventory
// (v2/data/ground/near.json, scripts/v2/ground_near.py from data/ground.geojson: OSM surfaces + landuse + the City's sidewalk slabs).
// Ground the inventory does not name takes its surface from the aerial's colour (green = lawn, dark = asphalt, else concrete).
// Textures: de-lit, tileable patches resampled onto the ground plane through the SOLVED cameras of the owner's photos (Anna Hiss
// photo-1: pavers, concrete, planting bed; Hogg IMG_0739: lawn); each is stored at linear mean TEX_MEAN, the shader scales it to ALBEDO.
// Albedos are on v2's scale, anchored on the fitted sidewalk concrete (SIDEWALK_LOOK.WALK) with each surface's ratio to the concrete
// measured in the same photograph (pavers 0.83x the concrete's light, warmer, then lifted 1.18x on 10-29: at photo-1's camera they rendered 0.84x the photo while the slab rendered 0.97x; lawn 0.39x the walk in IMG_0739; beds 0.17x). Plaza
// concrete is cleaner than the street sidewalks: drawn from Anna Hiss photo-1's camera under its matched sky the sidewalk tone
// rendered 0.57x the photo's courtyard slab, so the plaza concrete (and the pavers and beds measured against it) is 1.7-1.8x WALK.
// Far away the aerial stays (the city must still read from the air); the crossfade is the near street layer's own (NEAR_LOOK.FADE).
export const GROUND_NEAR_LOOK = {
  ON: true,
  FADE: [60, 90],               // metres from the camera: drawn ground fully in / gone (the aerial beyond)
  FADE_PHONE: [50, 75],
  MAX_CAMERA_Y_M: 140,          // above this nothing is drawn (and the class window is not updated)
  // the class window: a square of the inventory rasterised around the camera (antialiased coverage, linear filtered)
  WINDOW_PX: 1024, WINDOW_RES_M: 0.25,          // 256 m
  WINDOW_PX_PHONE: 512, WINDOW_RES_M_PHONE: 0.4, // 205 m
  WINDOW_EDGE_M: 6,             // the drawn ground fades out over this much at the window's edge
  BUCKET_M: 64,                 // spatial index of the inventory (speed only)
  // class edges: coverage is sharpened from [lo, hi] (0.5 = the mapped edge); rule 15: the edge is antialiased by the texture filter
  EDGE_SHARPEN: [0.35, 0.65],   // at 0.25 m a window pixel: the edge is soft over ~8 cm
  // surfaces: [albedo sRGB hex on v2's scale, tile size [x, z] metres, texture's stored linear mean]
  CONCRETE: { color: '#4e493f', tile: [1.2, 1.2], texMean: 0.5, tex: 'ground-concrete.jpg' },
  PAVERS:   { color: '#4e4438', tile: [0.904, 1.54], texMean: 0.5, tex: 'ground-pavers.jpg' },   // 1 x 5 pattern periods (autocorrelation)
  GRASS:    { color: '#1d2311', tile: [0.96, 0.96], texMean: 0.16, tex: 'ground-grass.jpg' },
  BED:      { color: '#1a1b0d', tile: [1.16, 1.16], texMean: 0.16, tex: 'ground-bed.jpg' },
  ASPHALT:  { color: '#3d3e40', tile: [1.2, 1.2], texMean: 0.5, tex: 'ground-concrete.jpg', grain: 0.5 },   // NEAR_LOOK.ASPHALT; concrete grain at half strength
  TEX_CONTRAST: { concrete: 0.8, pavers: 1.0, grass: 0.55, bed: 1.0, asphalt: 0.5 },   // grass 1.0 read as camouflage (live look 10-30)   // 1 = the photograph's own texture contrast
  VARIATION: 0.14,              // +- brightness over ~8 m (breaks up the tiling; far bigger than a pixel, so no shimmer)
  VARIATION_M: 8,
  // the aerial hint for ground the inventory does not name (read off a ~2 m blur of the photograph)
  HINT_BLUR: 16,                // x the screen pixel's footprint on the photograph (far away)
  HINT_MAJORITY_M: 5,           // ...and never finer than this much ground: the hint is a majority over a few metres, not per pixel
  HINT_GREEN: [0.04, 0.12],     // (g - max(r, b)) / luminance: concrete -> lawn
  HINT_DARK: [0.045, 0.075],    // linear luminance after the shadow lift: asphalt below the first, concrete above the second
  HINT_SHADOW_LIGHT: 0.6,       // where the shadow mask says building shadow, dark is not taken as asphalt beyond this share
  FRONTAGE_OFF: true,           // the near street layer's flat frontage colours (paving / lawn / mulch) give way to this layer
};
