// The one place v2 turns longitude / latitude into the scene's metres. Every layer (extrusions, roads, trees, the route,
// the Blender tiles) goes through this, so they all line up by construction.
//
// Frame (the tile contract, v2/tiles/manifest.json): local metres around ORIGIN, three.js axes:
//   x = metres east, y = metres up (above the origin's ground; the ground is flat, see ground note in main.js), z = metres SOUTH.
// Projection: a local equirectangular tangent plane on the WGS84 equatorial radius. Across the 4 km the app covers it is
// within a few centimetres of a true local ENU frame, which is far below what anything here can show.

export const ORIGIN = { lat: 30.28601, lon: -97.73932 };
export const EARTH_R = 6378137;
export const TILE_M = 250;            // the extrusion tiles' size; the same grid as the Blender tiles (t_<i>_<j>)

const D2R = Math.PI / 180;
let kx = EARTH_R * D2R * Math.cos(ORIGIN.lat * D2R);
const kz = EARTH_R * D2R;

// The manifest carries its own origin. If it ever differs from the default, call this before anything is built.
export function setOrigin(lat, lon) {
  ORIGIN.lat = lat; ORIGIN.lon = lon;
  kx = EARTH_R * D2R * Math.cos(lat * D2R);
}

export function toLocal(lon, lat) {
  return [(lon - ORIGIN.lon) * kx, -(lat - ORIGIN.lat) * kz];
}

export function toLonLat(x, z) {
  return [ORIGIN.lon + x / kx, ORIGIN.lat - z / kz];
}

export function tileOf(x, z) {
  return [Math.floor(x / TILE_M), Math.floor(z / TILE_M)];
}
