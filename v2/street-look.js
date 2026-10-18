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
  LEAN_PAVING: '#6b6860',
  LEAN_STRENGTH: 0.5,

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
