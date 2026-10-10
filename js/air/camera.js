/**
 * camera.js — the chase camera, an OUTPUT of the craft (the rule in the header
 * of js/controls.js: the eye is the state; MapLibre's centre and zoom are
 * derived once per frame and written with one jumpTo, nothing else steers them).
 *
 * The eye trails the craft by `back` metres along a lagged heading and sits
 * `up` metres above; it looks at a point `lookAheadM` metres ahead of the craft
 * itself, so a turn swings the camera round the craft and the lag reads as
 * speed. Bank is shown as map roll (a share of the craft's own bank); the
 * field of view widens with speed.
 *
 * Pose derivation is js/controls.js writeToMap(), in the same closed forms
 * (MapLibre 512 px tiles; reproduces transform.getCameraAltitude()).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./params.js'), require('./geo.js'));
  else root.AirCamera = factory(root.AIR, root.AirGeo);
})(typeof self !== 'undefined' ? self : this, function (AIR, G) {
  'use strict';
  const { RAD, wrap180, clamp, toLngLat } = G;
  const C = 40030228.884, ZOOM_MIN = 14.0, ZOOM_MAX = 21.5;
  const sin = Math.sin, cos = Math.cos, tan = Math.tan, exp = Math.exp;

  /** `map` only supplies the canvas height and the field of view; pass a stub in node. */
  function create(map, P) {
    P = P || AIR;
    const K = () => P.camera;
    const cvH = () => (map && map.getCanvas ? map.getCanvas().clientHeight : 900) || 900;
    const fovNow = () => (map && map.getVerticalFieldOfView ? map.getVerticalFieldOfView() : K().fovBase);
    const camPx = fov => 0.5 * cvH() / tan(fov * RAD / 2);
    const mpp = (z, lat) => C * cos(lat * RAD) / (512 * Math.pow(2, z));
    const s = { init: false, ex: 0, ey: 0, ez: 0, yaw: 0, pitch: 0, fov: K().fovBase, last: null };
    const rollOK = !!(map && typeof map.getRoll === 'function' && typeof map.setRoll === 'function');
    const fovOK = !!(map && typeof map.setVerticalFieldOfView === 'function');

    function reset() { s.init = false; s.last = null; }

    /** Advance the lagged camera state and return the eye (does not touch the map). */
    function solve(c, dt) {
      const k = K();
      if (!s.init) { s.yaw = c.yaw; s.pitch = c.pitch * 0.8; s.fov = k.fovBase; }
      const ky = s.init ? 1 - exp(-dt / k.tauYaw) : 1, kp = s.init ? 1 - exp(-dt / k.tauPitch) : 1;
      s.yaw += wrap180(c.yaw - s.yaw) * ky;
      s.pitch += (c.pitch * 0.8 - s.pitch) * kp;
      const boostShare = clamp((c.v - P.flight.vCruise) / (P.flight.vBoost - P.flight.vCruise), 0, 1.2);
      const back = k.back + k.backBoost * boostShare;
      const cp = cos(s.pitch * RAD);
      const tx = c.x - sin(s.yaw * RAD) * cp * back, ty = c.y - cos(s.yaw * RAD) * cp * back;
      const tz = c.z - sin(s.pitch * RAD) * back + k.up;
      if (!s.init) { s.ex = tx; s.ey = ty; s.ez = tz; s.init = true; }
      else { const kpos = 1 - exp(-dt / k.tauPos); s.ex += (tx - s.ex) * kpos; s.ey += (ty - s.ey) * kpos; s.ez += (tz - s.ez) * kpos; }
      const ch = cos(c.pitch * RAD);
      const lx = c.x + sin(c.yaw * RAD) * ch * k.lookAheadM, ly = c.y + cos(c.yaw * RAD) * ch * k.lookAheadM, lz = c.z + sin(c.pitch * RAD) * k.lookAheadM;
      const dx = lx - s.ex, dy = ly - s.ey, dz = lz - s.ez;
      const bearing = Math.atan2(dx, dy) / RAD, elev = Math.atan2(dz, Math.hypot(dx, dy)) / RAD;
      const fovT = k.fovBase + (k.fovMax - k.fovBase) * clamp((c.v - P.flight.vCruise) / (P.flight.vMax - P.flight.vCruise), 0, 1);
      s.fov += (fovT - s.fov) * (s.last ? 1 - exp(-dt / 0.35) : 1);
      return { ex: s.ex, ey: s.ey, ez: s.ez, bearing: (bearing + 360) % 360, elev, fov: s.fov, roll: c.roll * k.bankFollow };
    }

    /** Eye + bearing + elevation -> MapLibre centre / zoom / pitch at the given FOV and canvas height. */
    function pose(e, fov) {
      const alt = Math.max(e.ez, 2);
      const lat0 = toLngLat(e.ex, e.ey).lat;
      const dMax = camPx(fov) * mpp(ZOOM_MIN, lat0);
      const pitchCap = Math.acos(clamp(alt / dMax, 0, 1)) / RAD;
      const pitch = clamp(90 + e.elev, K().pitchMin, Math.min(K().maxPitchMap, K().pitchMax, pitchCap));
      const lead = alt * tan(pitch * RAD);
      const cx = e.ex + sin(e.bearing * RAD) * lead, cy = e.ey + cos(e.bearing * RAD) * lead;
      const ll = toLngLat(cx, cy);
      const D = alt / cos(pitch * RAD);
      const zoom = clamp(Math.log2(C * cos(ll.lat * RAD) * camPx(fov) / (512 * D)), ZOOM_MIN, ZOOM_MAX);
      return { center: [ll.lng, ll.lat], zoom, bearing: e.bearing, pitch };
    }

    /** One frame: solve and write the map. Returns the pose written. */
    function update(c, dt) {
      const e = solve(c, dt);
      if (fovOK && Math.abs(fovNow() - e.fov) > 0.01) map.setVerticalFieldOfView(e.fov);
      const p = pose(e, fovOK ? fovNow() : e.fov);
      if (rollOK) p.roll = e.roll;
      map.jumpTo(p, { fly: true, air: true });
      s.last = p;
      return p;
    }
    /** Put the neutral roll and FOV back (hand-back / cleanup). */
    function release() {
      try { if (rollOK && map.getRoll() !== 0) map.setRoll(0); } catch (e) {}
      try { if (fovOK) map.setVerticalFieldOfView((window.GFX && window.GFX.fov) || 58); } catch (e) {}
    }
    return { reset, solve, pose, update, release, state: s };
  }
  return { create };
});
