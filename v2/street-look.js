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
  WALK: '#86837b',
  CONCRETE_GRAIN: 0.08,
  JOINT_M: 1.52,                // 5 ft slabs
  JOINT_DARK: 0.35,
  SIGN_POST: '#8b8d8f',
  SIGN_POST_M: 3.1,
  SIGN_POST_R_M: 0.045,         // 0.03 read as a hairline from 8 m up
  FRONT_PAVING: '#837f76',      // the right-of-way past the sidewalk: plaza and frontage paving, ...
  FRONT_LAWN: '#4b5733',        // ... lawn and planting strips, ...
  FRONT_MULCH: '#4d4034',       // ... mulch and bare soil (classes read off the aerial per 3 m: street_near.py)
  LAWN_GRAIN: 0.12,
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
