/**
 * geo.js — the one local frame Air Race lives in: metres east / north / up of
 * the UT Tower (AIR.origin). Gates, the craft, ghost samples and the height
 * raster all share it, so there is exactly one place a coordinate can go wrong.
 *
 * toLocal / toLngLat are exact inverses of each other (the longitude scale is
 * taken at the point's own latitude, as js/controls.js does with mLon(lat)).
 * Against true Mercator over the course (about 4.5 km north to south) the
 * error is under a metre.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./params.js'));
  else root.AirGeo = factory(root.AIR);
})(typeof self !== 'undefined' ? self : this, function (AIR) {
  'use strict';
  const M_LAT = AIR.mPerDegLat, O = AIR.origin, RAD = Math.PI / 180;
  const mLon = lat => M_LAT * Math.cos(lat * RAD);
  const toLocal = (lng, lat) => ({ x: (lng - O.lng) * mLon(lat), y: (lat - O.lat) * M_LAT });
  const toLngLat = (x, y) => { const lat = O.lat + y / M_LAT; return { lng: O.lng + x / mLon(lat), lat }; };
  const wrap180 = d => ((d % 360) + 540) % 360 - 180;
  const wrap360 = d => ((d % 360) + 360) % 360;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return { M_LAT, mLon, toLocal, toLngLat, wrap180, wrap360, clamp, RAD };
});
