// v2's camera controls: the old app's FLYCAM (js/controls.js), ported to three.js metres. Owner, 2026-10-18: "the controls are
// like the blender controls or the 3d editor controls can you make the controls like the OG?" So v2 drops three.js MapControls
// (orbit around a target) and flies the way v1 does:
//
//   Desktop  WASD / arrow keys move along the ground (relative to where you look), Shift = boost x2.5,
//            drag (any mouse button) = look (turn and tilt the camera about the eye, not about a target),
//            the wheel, Q / E (or Page Up / Page Down) = altitude (multiplicative), R = back to the home view.
//   Phone    the joystick (bottom left) moves, BOOST (bottom right) latches the x2.5 boost, one finger looks,
//            two fingers pinch (spread = down) or drag up / down for altitude, double-tap-and-drag = altitude with one thumb.
//
// THE EYE IS THE STATE, as in v1: eye (x, z), alt, bearing, pitch. The three.js camera is written from it once a frame while
// someone is flying, and read back into it while nobody is (so the loading screen's flight, the finder's flights and every
// script that places the camera run untouched; the first input takes the camera over where it is).
//
// Every number below is v1's (js/controls.js), with the line it comes from, unless a note says why v2 differs. The differences:
//   - look sensitivity and the boost's FOV kick are scaled by v2's lens (40 degrees, v1's is 58), so a drag moves the picture by
//     the same share of the screen as in v1;
//   - v1's zoom-derived limits are left out (pitchFloor / pitchCap / altCeiling: MapLibre cannot express a camera below zoom 14
//     or above 22; v1's own comments call them restrictions of the engine, not choices). v2 keeps v1's authored limits: pitch
//     5..88 degrees from straight down, eye 1.7..900 m;
//   - collision reads v2's own footprints (the plain buildings, raised to the Blender models' tops) and trunks; the raised campus
//     courts and the DKR bowl surface of v1 have no v2 data yet, so the stadium is a solid to the camera.
// Every value is in FLY (rule 11: one line to overrule).
import * as THREE from 'three';

export const FLY = {
  // ── limits (controls.js 119, 142-143) ──
  PITCH_MIN: 5, PITCH_MAX: 88,          // degrees from straight down; 88 shows the sky above the horizon
  ALT_MIN: 1.7,                         // eye height of a person standing (controls.js 121-133)
  ALT_MAX: 900,
  ALT_SLACK: 30,
  ALT_GROUND: 12,                       // below this the pedestrian collision values blend in
  // ── speed (controls.js 66-68): 40 m/s at ALT_REF, x (alt / ALT_REF)^0.75, 1..120 m/s; Shift / BOOST x2.5 ──
  SPEED_REF: 40, SPEED_EXP: 0.75, SPEED_MIN: 1.0, SPEED_MAX: 120, SPRINT: 2.5,
  ALT_REF: 163,                         // v1 takes it from its spawn pose: 162.9 m on a 900 px tall window (zoom 16.5, pitch 74)
  TAU_ACCEL: 0.20, TAU_DECEL: 0.45, V_EPS: 0.05,   // the glide: speeds up over ~0.2 s, coasts to a stop over ~0.45 s
  // ── look (controls.js 70-72): degrees per pixel dragged ──
  SENS_YAW_MOUSE: 0.20, SENS_PITCH_MOUSE: 0.13, SENS_YAW_TOUCH: 0.18, SENS_PITCH_TOUCH: 0.11, LOOK_DEADZONE: 0.4,
  V1_FOV_DEG: 58,                       // the sensitivities above are scaled by (v2 fov / this): the same drag, the same share of screen
  // ── altitude (controls.js 149-152) ──
  VERT_GAIN: 0.25,                      // Q / E: x e^0.25 per second
  WHEEL_GAIN: 0.0018,                   // per wheel pixel (one notch of 100 px = x0.84 / x1.2); wheel down = down
  PAN2_GAIN: 0.0022, TAPDRAG_GAIN: 0.0055,
  DT_MAX: 0.10, DT_BAIL: 1.0,
  // ── collision (controls.js 162-186) ──
  R_CAM: 6, SKIN: 2.5, SKIN_V: 8, STEP_UP: 12, HARD_CLEAR: 4,
  R_CAM_GROUND: 1.0, SKIN_V_GROUND: 0.8, STEP_UP_GROUND: 0.5,
  LIFT: 45, FALL: 25, TAU_FLOOR_UP: 0.25, TAU_FLOOR_DOWN: 0.80, FLOOR_LOOKAHEAD: 0.5,
  BRAKE_PROBES: [[0.9, 0.55], [0.5, 0.30], [0.25, 0.12]],
  SAFE_ALT: 105,                        // the floor while the footprints are not in yet (fail safe, never fail open)
  FENCE_SOFT: 250,                      // the camera eases to a stop this close to the edge of the modelled city
  TRUNK_PAD: 0.9, TRUNK_CLEAR: 0.5,     // controls.js 797-798
  // ── joystick and taps (controls.js 227, 1291) ──
  JOY_RADIUS: 34, JOY_DEAD: 0.12, JOY_EXPO: 1.6, TAP_MS: 280, TAP_PX: 24,
  HOME_MS: 900,                         // R eases home over this
  // the near plane follows the eye down (v2: a 1.7 m eye 1 m from a wall must not clip it): alt x NEAR_PER_M, within NEAR_M
  NEAR_PER_M: 0.25, NEAR_M: [0.25, 1.5],
  // the point the shadow box and the map's "centre" use is on the ground along the view, but no further than this pitch's lead
  FOCUS_PITCH_DEG: 80,
  // ── the feel (controls.js TUNE, 236-296) ──
  TUNE: {
    BANK_MAX: 5, BANK_PER_DEGPS: 0.08, BANK_STRAFE: 1.5, TAU_YAW_RATE: 0.12, TAU_BANK_IN: 0.30, TAU_BANK_OUT: 0.18,
    YAW_RATE_CLAMP: 240, ROLL_EPS: 0.02,
    FOV_KICK: 7, FOV_KICK_FROM: 1.0, TAU_FOV: 0.45, FOV_EPS: 0.02,   // FOV_KICK is v1's degrees on its 58: scaled to v2's lens
    BOB_AMP_ALT: 0.45, BOB_AMP_ALT_GROUND: 0.06, SETTLE_AMP_GROUND: 0.10, BOB_AMP_PITCH: 0.12, BOB_PERIOD: 5.0,
    BOB_MAX_SPEED: 1.5, BOB_TIMEOUT: 8.0, BOB_FADE: 2.0, TAU_BOB: 0.7,
    SETTLE_AMP: 0.7, SETTLE_DUR: 0.9, SETTLE_MIN_SPEED: 12, SETTLE_TRIG_SPEED: 2,
    PITCH_SPEED: 2.0, TAU_PITCH_SPD: 1.2, TAU_PITCH_SPD_OUT: 0.4, PITCH_SPD_IDLE: 3.0,
    WALL_TAU: 0.22, WALL_STEER: 55, WALL_PROBE_AHEAD: 10, WALL_PROBE_ANGLE: 40,
  },
};

const D2R = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrap360 = (d) => ((d % 360) + 360) % 360;
const MOVE_CODES = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'PageUp', 'PageDown'];
const STEP_CODES = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'];
const TEXT_INPUT_TYPES = /^(|text|search|url|tel|email|password|number|date|time|datetime-local|month|week)$/;
// typing beats flying; a slider or a select keeps its own arrow keys (controls.js 1407-1456)
const textTarget = (t) => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
  (t.tagName === 'INPUT' && TEXT_INPUT_TYPES.test((t.type || '').toLowerCase())));
const stepTarget = (t) => !!t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t.type || '').toLowerCase() === 'range'));

// The world the camera bumps into: footprints with tops (exact polygon tests in 32 m buckets, as controls.js 402-459) and trunks.
export class CollisionField {
  constructor() { this.buckets = new Map(); this.trunks = new Map(); this.polys = []; this.ready = false; this.seen = 0; this.byId = new Map(); }
  static B = 32; static TB = 8;
  // data from city-worker.js ('collide'): coords [x, z, ...], ringStart, polyRing, polyTop, polyId (index into ids)
  setFootprints({ coords, ringStart, polyRing, polyTop, polyId, ids }) {
    const B = CollisionField.B;
    this.buckets.clear(); this.polys = []; this.byId.clear();
    for (let p = 0; p + 1 < polyRing.length; p++) {
      const rings = [];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let r = polyRing[p]; r < polyRing[p + 1]; r++) {
        const a = ringStart[r], b = ringStart[r + 1];
        rings.push([a, b]);
        if (r === polyRing[p]) for (let i = a; i < b; i++) { const x = coords[i * 2], z = coords[i * 2 + 1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
      }
      const e = { rings, top: polyTop[p], minX, maxX, minZ, maxZ, seen: 0 };
      this.polys.push(e);
      // Campus outlines carry full UUIDs; the tile contract uses their eight-hex prefix.
      // Keep exact ids too: OSM/City ids must not acquire arbitrary prefix matches.
      const id = String(ids[polyId[p]]);
      const keys = /^[0-9a-f]{8}-/i.test(id) ? [id, id.slice(0, 8)] : [id];
      for (const key of keys) (this.byId.get(key) || this.byId.set(key, []).get(key)).push(e);
      for (let i = Math.floor(minX / B); i <= Math.floor(maxX / B); i++) for (let j = Math.floor(minZ / B); j <= Math.floor(maxZ / B); j++) {
        const k = i * 65536 + j; (this.buckets.get(k) || this.buckets.set(k, []).get(k)).push(e);
      }
    }
    this.coords = coords;
    this.ready = true;
  }
  // a Blender model stands where these outlines are: the camera bumps into the model's top, not the plain extrusion's
  setTop(mapIds, top) {
    if (!Number.isFinite(top) || !(top > 0)) return;
    const list = new Set(mapIds.flatMap((id) => this.byId.get(String(id)) || []));
    // Every replaced outline is a solid up to the model top, including low wings and
    // downtown podium levels. Shared outlines take the taller model, in either load order.
    for (const e of list) { e.modelTop = Math.max(e.modelTop || 0, top); e.top = e.modelTop; }
  }
  // A tile can contain a model absent from the plain-building data. Register a conservative
  // convex footprint from its actual above-ground vertices before it appears. No extra fetch,
  // no retained mesh data; normal footprints (and their courtyard holes) stay untouched.
  addTile(root, tile, buildings) {
    const missing = new Map();
    (tile.buildings || []).forEach((slug, i) => {
      const b = buildings[slug];
      if (b?.map_ids?.length && Number.isFinite(b.top) && b.top > 0 && !b.map_ids.some((id) => this.byId.has(String(id)))) missing.set(i, { b, points: [] });
    });
    if (!missing.size) return;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const p = o.geometry?.getAttribute('position'), ids = o.geometry?.getAttribute('_building');
      if (!p || !ids) return;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        const entry = missing.get(Math.round(ids.getX(i))); if (!entry) continue;
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        if (v.y > 0.5) entry.points.push([v.x, v.z]);
      }
    });
    for (const { b, points } of missing.values()) {
      points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const unique = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
      const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const half = (pts) => { const h = []; for (const p of pts) { while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } return h.slice(0, -1); };
      const hull = [...half(unique), ...half(unique.slice().reverse())];
      if (hull.length < 3) continue;
      // Reuse the same polygon indexing and exact touch tests as the worker outlines.
      const f = new CollisionField();
      f.setFootprints({ coords: new Float32Array(hull.flat()), ringStart: [0, hull.length], polyRing: [0, 1], polyTop: [b.top], polyId: [0], ids: [String(b.map_ids[0])] });
      const e = f.polys[0];
      // This field's coords are shared by all rings, so append once and rebase the new ring.
      const offset = this.coords.length / 2, coords = new Float32Array(this.coords.length + f.coords.length);
      coords.set(this.coords); coords.set(f.coords, this.coords.length); this.coords = coords;
      e.rings = e.rings.map(([a, z]) => [a + offset, z + offset]); e.modelTop = b.top;
      this.polys.push(e);
      for (const id of b.map_ids) this.byId.set(String(id), [e]);
      for (const [key, list] of f.buckets) (this.buckets.get(key) || this.buckets.set(key, []).get(key)).push(...list);
    }
  }
  // trunks: [x, z, radius, top] x n
  setTrunks(list) {
    const TB = CollisionField.TB; this.trunks.clear();
    for (let n = 0; n < list.length; n += 4) {
      const x = list[n], z = list[n + 1], rb = list[n + 2] + FLY.TRUNK_PAD, h = list[n + 3];
      for (let i = Math.floor((x - rb) / TB); i <= Math.floor((x + rb) / TB); i++) for (let j = Math.floor((z - rb) / TB); j <= Math.floor((z + rb) / TB); j++) {
        const k = i * 65536 + j; (this.trunks.get(k) || this.trunks.set(k, []).get(k)).push(x, z, rb, h);
      }
    }
  }
  touches(e, x, z, r) {
    if (x + r < e.minX || x - r > e.maxX || z + r < e.minZ || z - r > e.maxZ) return false;
    const C = this.coords, r2 = r * r;
    let inShell = false, inHole = false;
    for (let k = 0; k < e.rings.length; k++) {
      const [a0, b0] = e.rings[k]; let inside = false;
      for (let a = a0, b = b0 - 1; a < b0; b = a++) {
        const px = C[a * 2], pz = C[a * 2 + 1], qx = C[b * 2], qz = C[b * 2 + 1], dx = qx - px, dz = qz - pz;
        const L2 = dx * dx + dz * dz, t = L2 ? clamp(((x - px) * dx + (z - pz) * dz) / L2, 0, 1) : 0;
        if ((x - px - t * dx) ** 2 + (z - pz - t * dz) ** 2 <= r2) return true;
        if ((pz > z) !== (qz > z) && x < (qx - px) * (z - pz) / (qz - pz) + px) inside = !inside;
      }
      if (k === 0) inShell = inside; else if (inside) inHole = true;
    }
    return inShell && !inHole;
  }
  // the highest top within r metres of (x, z); 0 over open ground
  heightIn(x, z, r) {
    const B = CollisionField.B, q = ++this.seen;
    let best = 0;
    for (let i = Math.floor((x - r) / B); i <= Math.floor((x + r) / B); i++) for (let j = Math.floor((z - r) / B); j <= Math.floor((z + r) / B); j++) {
      for (const e of this.buckets.get(i * 65536 + j) || []) {
        if (e.seen === q) continue; e.seen = q;
        if (e.top > best && this.touches(e, x, z, r)) best = e.top;
      }
    }
    return best;
  }
  trunkAt(x, z, alt) {
    if (alt >= FLY.ALT_GROUND || !this.trunks.size) return false;
    const a = this.trunks.get(Math.floor(x / CollisionField.TB) * 65536 + Math.floor(z / CollisionField.TB));
    if (!a) return false;
    for (let k = 0; k < a.length; k += 4) {
      if (alt >= a[k + 3] + FLY.TRUNK_CLEAR) continue;
      const dx = x - a[k], dz = z - a[k + 1];
      if (dx * dx + dz * dz < a[k + 2] * a[k + 2]) return true;
    }
    return false;
  }
}

export class FlyControls extends THREE.EventDispatcher {
  // camera, canvas; opts: { bounds: {minX, maxX, minZ, maxZ}, field: CollisionField, isEasing(), home(), joystick: {base, knob, zone} }
  constructor(camera, canvas, opts = {}) {
    super();
    this.camera = camera; this.canvas = canvas; this.opts = opts;
    this.field = opts.field || new CollisionField();
    this.target = new THREE.Vector3();          // the ground point at the centre of the view (MapLibre's "center", maplite.js)
    this.focus = new THREE.Vector3();           // the same, no further than FOCUS_PITCH_DEG's lead (the shadow box follows this)
    this.enabled = true;
    this.fovBase = camera.fov;
    this.lookScale = this.fovBase / FLY.V1_FOV_DEG;
    // state: the eye is the truth (controls.js 319-325)
    this.eye = { x: 0, z: 0 }; this.alt = 0; this.altUser = 0; this.altFloor = 0;
    this.vel = { e: 0, n: 0 }; this.bearing = 0; this.pitch = 60;
    this.pendingYaw = 0; this.pendingPitch = 0; this.wheelLogAcc = 0; this.touchLogAcc = 0;
    this.lastTs = null; this.wasDriving = false; this.simTime = 0; this.inputLatch = false;
    this.keys = Object.create(null); this.sprintHeld = false; this.boostOn = false;
    // feel state (output offsets, never part of the eye)
    Object.assign(this, { yawRate: 0, rollNow: 0, fovKickNow: 0, bobGain: 0, settleT: Infinity, peakSpeed: 0, prevSpeed: 0, pitchSpdNow: 0,
      lastRealInputT: -1e9, lastPitchInputT: -1e9, fxAltOff: 0, fxPitchOff: 0, fxLive: false, trunkStuck: false });
    this.pointers = new Map(); this.lookId = null; this.pinchDist = null; this.pinchCy = 0;
    this.lastTapAt = 0; this.lastTapX = 0; this.lastTapY = 0; this.tapDragId = null;
    this.joyId = null; this.joyFwd = 0; this.joyStrafe = 0; this.joyOx = 0; this.joyOy = 0;
    this.flyingSince = 0; this.flyingTimer = 0;
    this.stats = { ticks: 0, msAvg: 0 };
    this.clock = () => performance.now();       // the verify script swaps in a manual clock to step the controls exactly
    this.bind();
    this.syncFromCamera();
  }

  // ── derived ──
  groundMix(a = this.alt) { return clamp((FLY.ALT_GROUND - a) / (FLY.ALT_GROUND - FLY.ALT_MIN), 0, 1); }
  rCam() { return lerp(FLY.R_CAM, FLY.R_CAM_GROUND, this.groundMix()); }
  skinV() { return lerp(FLY.SKIN_V, FLY.SKIN_V_GROUND, this.groundMix()); }
  stepUp() { return lerp(FLY.STEP_UP, FLY.STEP_UP_GROUND, this.groundMix()); }
  heightIn(x, z, r = this.rCam()) { return this.field.ready ? this.field.heightIn(x, z, r) : 0; }
  blocks(h, a) { return h > 0 && h + FLY.SKIN > a; }
  blockedAt(x, z) { return this.blocks(this.heightIn(x, z), this.alt); }
  trunkBlockedAt(x, z) { return !this.trunkStuck && this.field.trunkAt(x, z, this.alt); }
  hardBlockedAt(x, z) { return this.trunkBlockedAt(x, z) || (this.field.ready && this.blockedAt(x, z)); }

  // ── read the camera into the eye (nobody is flying: something else may be moving it) ──
  syncFromCamera(keepInput = false) {
    const c = this.camera, d = c.getWorldDirection(new THREE.Vector3());
    this.eye.x = c.position.x; this.eye.z = c.position.z; this.alt = c.position.y;
    this.pitch = clamp(Math.acos(clamp(-d.y, -1, 1)) / D2R, FLY.PITCH_MIN, FLY.PITCH_MAX);
    this.bearing = wrap360(Math.atan2(d.x, -d.z) / D2R);
    this.altUser = this.alt; this.altFloor = 0; this.vel.e = 0; this.vel.n = 0;
    if (!keepInput) this.pendingYaw = this.pendingPitch = this.wheelLogAcc = this.touchLogAcc = 0;
    this.placeTargets(this.alt, this.pitch);
    this.fitNear(this.alt);
  }
  placeTargets(alt, pitch) {
    const b = this.bearing * D2R, lead = alt * Math.tan(pitch * D2R), lf = Math.min(lead, alt * Math.tan(FLY.FOCUS_PITCH_DEG * D2R));
    this.target.set(this.eye.x + lead * Math.sin(b), 0, this.eye.z - lead * Math.cos(b));
    this.focus.set(this.eye.x + lf * Math.sin(b), 0, this.eye.z - lf * Math.cos(b));
  }

  // ── write the eye into the camera ──
  write() {
    const c = this.camera;
    let outAlt = this.alt + this.fxAltOff;
    const h = this.heightIn(this.eye.x, this.eye.z);
    if (h > 0) outAlt = Math.max(outAlt, h + FLY.HARD_CLEAR);   // an offset may never dip below the hard net
    outAlt = Math.max(outAlt, 0.5);
    const outPitch = clamp(this.pitch + this.fxPitchOff, Math.min(this.pitch, FLY.PITCH_MIN), Math.max(this.pitch, FLY.PITCH_MAX));
    c.position.set(this.eye.x, outAlt, this.eye.z);
    c.rotation.set(-(90 - outPitch) * D2R, -this.bearing * D2R, -this.rollNow * D2R, 'YXZ');
    const fov = this.fovBase + this.fovKickNow;
    if (Math.abs(c.fov - fov) > 1e-3) { c.fov = fov; c.updateProjectionMatrix(); }
    this.fitNear(outAlt);
    c.updateMatrixWorld();
    this.placeTargets(outAlt, outPitch);
    this.dispatchEvent({ type: 'change' });
  }

  // the near plane follows the eye's height (whoever placed the camera): a 1.7 m eye a metre from a wall must not cut it away
  fitNear(alt) {
    const c = this.camera, near = clamp(alt * FLY.NEAR_PER_M, FLY.NEAR_M[0], FLY.NEAR_M[1]);
    if (Math.abs(c.near - near) > 1e-3) { c.near = near; c.updateProjectionMatrix(); }
  }
  // put the lens back (a hand-back: whatever moves the camera next starts from the plain lens, level)
  resetEffectsHard() {
    Object.assign(this, { yawRate: 0, rollNow: 0, fovKickNow: 0, bobGain: 0, settleT: Infinity, peakSpeed: 0, prevSpeed: 0, pitchSpdNow: 0, fxAltOff: 0, fxPitchOff: 0, fxLive: false });
    const c = this.camera;
    if (Math.abs(c.fov - this.fovBase) > 1e-3) { c.fov = this.fovBase; c.updateProjectionMatrix(); }
  }

  // ── wall deflection and the speed brake (controls.js 1183-1217) ──
  wallDeflect(sdt, eBlk, nBlk) {
    const T = FLY.TUNE, v = this.vel, f = Math.exp(-sdt / T.WALL_TAU);
    if (eBlk) v.e *= f; if (nBlk) v.n *= f;
    if (Math.hypot(v.e, v.n) < 0.02) { if (eBlk && nBlk) { v.e = 0; v.n = 0; } return; }
    const hd = Math.atan2(v.e, v.n), pa = T.WALL_PROBE_ANGLE * D2R;
    const probe = (a) => this.heightIn(this.eye.x + Math.sin(a) * T.WALL_PROBE_AHEAD, this.eye.z - Math.cos(a) * T.WALL_PROBE_AHEAD);
    const hL = probe(hd - pa), hR = probe(hd + pa);
    const freeL = !this.blocks(hL, this.alt), freeR = !this.blocks(hR, this.alt);
    let rot = 0;
    if (freeR && !freeL) rot = T.WALL_STEER * D2R * sdt;
    else if (freeL && !freeR) rot = -T.WALL_STEER * D2R * sdt;
    else if (hL !== hR) rot = (hR < hL ? 1 : -1) * T.WALL_STEER * D2R * sdt;
    if (rot) { const cR = Math.cos(rot), sR = Math.sin(rot), ve = v.e, vn = v.n; v.e = ve * cR + vn * sR; v.n = vn * cR - ve * sR; }
  }
  speedBrake() {
    if (!this.field.ready) return 1;
    const v = this.vel; if (Math.hypot(v.e, v.n) < 1) return 1;
    for (const [t, cap] of FLY.BRAKE_PROBES) if (this.blocks(this.heightIn(this.eye.x + v.e * t, this.eye.z - v.n * t), this.alt)) return cap;
    return 1;
  }

  // ── the frame (controls.js 1549-1878). Returns true when it wrote the camera. ──
  update() {
    if (!this.enabled) { this.lastTs = null; return false; }
    const ts = this.clock();
    if (this.lastTs === null) { this.lastTs = ts; if (!this.wasDriving) this.syncFromCamera(); return false; }
    const dtRaw = (ts - this.lastTs) / 1000;
    if (dtRaw <= 0) return false;                                // (the same frame twice)
    this.lastTs = ts;
    if (dtRaw > FLY.DT_BAIL) return false;                       // tab restore: never integrate a huge step
    const dt = Math.min(dtRaw, FLY.DT_MAX), t0 = performance.now(), T = FLY.TUNE;
    this.simTime += dt;
    const k = (c) => !!this.keys[c];
    const sprint = (this.sprintHeld || this.boostOn) ? FLY.SPRINT : 1;
    let fwd = 0, strafe = 0;
    if (k('KeyW') || k('ArrowUp')) fwd += 1;
    if (k('KeyS') || k('ArrowDown')) fwd -= 1;
    if (k('KeyD') || k('ArrowRight')) strafe += 1;
    if (k('KeyA') || k('ArrowLeft')) strafe -= 1;
    fwd += this.joyFwd; strafe += this.joyStrafe;
    const vertKey = (k('KeyQ') || k('PageUp') ? 1 : 0) - (k('KeyE') || k('PageDown') ? 1 : 0);

    // arbitration: while nobody flies, write nothing and read the camera (controls.js 1578-1639)
    const latched = this.inputLatch; this.inputLatch = false;
    const inputActive = latched || fwd !== 0 || strafe !== 0 || vertKey !== 0 || this.joyId !== null ||
      this.lookId !== null || this.tapDragId !== null || this.pointers.size >= 2 ||
      this.pendingYaw !== 0 || this.pendingPitch !== 0 || this.wheelLogAcc !== 0 || this.touchLogAcc !== 0;
    const resolvedAlt = clamp(Math.max(this.altUser, this.altFloor), FLY.ALT_MIN, FLY.ALT_MAX);
    const realDrive = inputActive || Math.hypot(this.vel.e, this.vel.n) > FLY.V_EPS || (this.wasDriving && Math.abs(this.alt - resolvedAlt) > 0.05);
    const driving = realDrive || this.fxLive;
    const easing = this.opts.isEasing ? this.opts.isEasing() : false;
    if (!driving) {
      if (this.wasDriving) { this.resetEffectsHard(); this.wasDriving = false; this.dispatchEvent({ type: 'end' }); }
      this.syncFromCamera(); return false;
    }
    if (!this.wasDriving) {
      // TAKEOVER: say so first (main.js stops any flight; the opening flight stands down), then start from where the camera is
      this.dispatchEvent({ type: 'start' });
      this.syncFromCamera(true);
      this.wasDriving = true;
    } else if (!realDrive && easing) {
      // only decaying effects held the camera and something else started moving it: let go at once
      this.resetEffectsHard(); this.wasDriving = false; this.dispatchEvent({ type: 'end' }); return false;
    }
    if (inputActive) this.lastRealInputT = this.simTime;

    // ── look
    let appliedYaw = 0;
    if (this.pendingYaw) { appliedYaw = -this.pendingYaw; this.bearing = wrap360(this.bearing - this.pendingYaw); this.pendingYaw = 0; }
    if (this.pendingPitch) { this.pitch = clamp(this.pitch + this.pendingPitch, FLY.PITCH_MIN, FLY.PITCH_MAX); this.lastPitchInputT = this.simTime; this.pendingPitch = 0; }

    // ── altitude (multiplicative: one key-second is the same proportional change at 20 m and at 800 m)
    let L = vertKey * FLY.VERT_GAIN * dt * sprint + this.wheelLogAcc + this.touchLogAcc;
    this.wheelLogAcc = 0; this.touchLogAcc = 0;
    const vertActive = L !== 0;
    if (L) this.altUser *= Math.exp(L);
    this.altUser = Math.max(this.altUser, this.alt - FLY.ALT_SLACK);
    this.altUser = clamp(this.altUser, FLY.ALT_MIN, FLY.ALT_MAX);

    // ── horizontal: clamp the magnitude (half a stick = half speed; W+D is not 1.41x)
    const m = Math.hypot(fwd, strafe);
    if (m > 1) { fwd /= m; strafe /= m; }
    const spdBase = clamp(FLY.SPEED_REF * Math.pow(this.alt / FLY.ALT_REF, FLY.SPEED_EXP), FLY.SPEED_MIN, FLY.SPEED_MAX);
    const spd = spdBase * sprint, brake = this.speedBrake(), b = this.bearing * D2R, v = this.vel;
    const tE = (fwd * Math.sin(b) + strafe * Math.cos(b)) * spd * brake;
    const tN = (fwd * Math.cos(b) - strafe * Math.sin(b)) * spd * brake;
    const tau = Math.hypot(tE, tN) >= Math.hypot(v.e, v.n) ? FLY.TAU_ACCEL : FLY.TAU_DECEL;
    const kk = 1 - Math.exp(-dt / tau);
    v.e += (tE - v.e) * kk; v.n += (tN - v.n) * kk;
    if (!fwd && !strafe && Math.hypot(v.e, v.n) < FLY.V_EPS) { v.e = 0; v.n = 0; }

    // ── fence: ease to a stop near the edge of the city
    const B = this.opts.bounds;
    if (B) {
      const S = FLY.FENCE_SOFT, dW = this.eye.x - B.minX, dE = B.maxX - this.eye.x, dS = B.maxZ - this.eye.z, dN = this.eye.z - B.minZ;
      if (v.e < 0 && dW < S) v.e *= clamp(dW / S, 0, 1);
      if (v.e > 0 && dE < S) v.e *= clamp(dE / S, 0, 1);
      if (v.n < 0 && dS < S) v.n *= clamp(dS / S, 0, 1);
      if (v.n > 0 && dN < S) v.n *= clamp(dN / S, 0, 1);
    }

    // ── advance and collide, in substeps no longer than the probe radius
    const frameDist = Math.hypot(v.e, v.n) * dt;
    const steps = Math.max(1, Math.ceil(frameDist / (FLY.R_CAM * 0.75))), sdt = dt / steps;
    let stepFloor = 0;
    this.trunkStuck = this.field.trunkAt(this.eye.x, this.eye.z, this.alt);
    for (let s = 0; s < steps; s++) {
      const px = this.eye.x + v.e * sdt, pz = this.eye.z - v.n * sdt;
      const tBlk = this.trunkBlockedAt(px, pz);
      if (!tBlk && (!this.field.ready || !this.blockedAt(px, pz))) { this.eye.x = px; this.eye.z = pz; }
      else {
        const hObs = this.heightIn(px, pz);
        if (!tBlk && hObs + FLY.SKIN - this.alt <= this.stepUp()) { stepFloor = Math.max(stepFloor, hObs + this.skinV()); this.eye.x = px; this.eye.z = pz; }
        else if (!this.hardBlockedAt(px, this.eye.z)) { this.eye.x = px; this.wallDeflect(sdt, false, true); }
        else if (!this.hardBlockedAt(this.eye.x, pz)) { this.eye.z = pz; this.wallDeflect(sdt, true, false); }
        else this.wallDeflect(sdt, true, true);
      }
    }
    if (B) { this.eye.x = clamp(this.eye.x, B.minX, B.maxX); this.eye.z = clamp(this.eye.z, B.minZ, B.maxZ); }

    // ── rooftop floor: ride over what is low enough, rise over it smoothly
    if (this.field.ready) {
      const ax = this.eye.x + v.e * FLY.FLOOR_LOOKAHEAD, az = this.eye.z - v.n * FLY.FLOOR_LOOKAHEAD;
      const roof = Math.max(this.heightIn(this.eye.x, this.eye.z), this.heightIn(ax, az));
      let want = roof > 0 ? roof + this.skinV() : 0;
      if (want - this.altUser > this.stepUp()) want = 0;
      want = Math.max(want, stepFloor);
      const tf = want > this.altFloor ? FLY.TAU_FLOOR_UP : FLY.TAU_FLOOR_DOWN;
      const next = this.altFloor + (want - this.altFloor) * (1 - Math.exp(-dt / tf));
      this.altFloor += clamp(next - this.altFloor, -FLY.FALL * dt, FLY.LIFT * dt);
    } else this.altFloor = FLY.SAFE_ALT;
    this.alt = clamp(Math.max(this.altUser, this.altFloor), FLY.ALT_MIN, FLY.ALT_MAX);
    // the hard net
    const h = this.heightIn(this.eye.x, this.eye.z);
    if (h > 0 && this.alt < h + FLY.HARD_CLEAR) this.alt = this.altUser = h + FLY.HARD_CLEAR;

    // ── the feel: bank into turns, a wider lens at full boost, a slow hover breath, a dip when stopping from speed, and the
    //    nose easing toward the horizon at speed. Output offsets only; each decays to zero after the last input.
    {
      const sp = Math.hypot(v.e, v.n);
      const instYaw = clamp(appliedYaw / dt, -T.YAW_RATE_CLAMP, T.YAW_RATE_CLAMP);
      this.yawRate += (instYaw - this.yawRate) * (1 - Math.exp(-dt / T.TAU_YAW_RATE));
      const bankT = clamp(this.yawRate * T.BANK_PER_DEGPS + strafe * T.BANK_STRAFE, -T.BANK_MAX, T.BANK_MAX);
      const tb = Math.abs(bankT) > Math.abs(this.rollNow) ? T.TAU_BANK_IN : T.TAU_BANK_OUT;
      this.rollNow += (bankT - this.rollNow) * (1 - Math.exp(-dt / tb));
      if (Math.abs(bankT) < 1e-3 && Math.abs(this.rollNow) < T.ROLL_EPS) this.rollNow = 0;
      const over = (sp / Math.max(1e-3, spdBase) - T.FOV_KICK_FROM) / Math.max(1e-3, FLY.SPRINT - T.FOV_KICK_FROM);
      const fovT = T.FOV_KICK * this.lookScale * clamp(over, 0, 1);
      this.fovKickNow += (fovT - this.fovKickNow) * (1 - Math.exp(-dt / T.TAU_FOV));
      if (fovT < T.FOV_EPS && this.fovKickNow < T.FOV_EPS) this.fovKickNow = 0;
      if (this.prevSpeed >= T.SETTLE_TRIG_SPEED && sp < T.SETTLE_TRIG_SPEED && this.peakSpeed >= T.SETTLE_MIN_SPEED && this.settleT >= T.SETTLE_DUR) { this.settleT = 0; this.peakSpeed = 0; }
      this.peakSpeed = Math.max(this.peakSpeed, sp); this.prevSpeed = sp;
      let settleOff = 0;
      if (this.settleT < T.SETTLE_DUR) { settleOff = -lerp(T.SETTLE_AMP, T.SETTLE_AMP_GROUND, this.groundMix()) * Math.sin(Math.PI * (this.settleT / T.SETTLE_DUR)); this.settleT += dt; }
      const tSince = this.simTime - this.lastRealInputT;
      const bobT = (tSince < T.BOB_TIMEOUT && sp < T.BOB_MAX_SPEED && vertKey === 0 && !vertActive) ? 1 : 0;
      this.bobGain += (bobT - this.bobGain) * (1 - Math.exp(-dt / T.TAU_BOB));
      if (bobT === 0 && this.bobGain < 0.01) this.bobGain = 0;
      const bobAmp = this.bobGain * clamp((T.BOB_TIMEOUT - tSince) / T.BOB_FADE, 0, 1);
      const ph = 2 * Math.PI * this.simTime / T.BOB_PERIOD;
      const bobAlt = bobAmp * lerp(T.BOB_AMP_ALT, T.BOB_AMP_ALT_GROUND, this.groundMix()) * (0.5 - 0.5 * Math.cos(ph));
      const bobPitch = bobAmp * T.BOB_AMP_PITCH * Math.sin(ph + 1.1);
      if (T.PITCH_SPEED > 0) {
        const idleOk = (this.simTime - this.lastPitchInputT) > T.PITCH_SPD_IDLE;
        const pT = idleOk ? T.PITCH_SPEED * clamp(sp / (spdBase * FLY.SPRINT), 0, 1) : 0;
        const tp = pT > this.pitchSpdNow ? T.TAU_PITCH_SPD : T.TAU_PITCH_SPD_OUT;
        this.pitchSpdNow += (pT - this.pitchSpdNow) * (1 - Math.exp(-dt / tp));
        if (pT === 0 && this.pitchSpdNow < 0.02) this.pitchSpdNow = 0;
      }
      this.fxAltOff = bobAlt + settleOff;
      this.fxPitchOff = bobPitch + this.pitchSpdNow;
      this.fxLive = this.rollNow !== 0 || this.fovKickNow > 0 || bobAmp > 0.005 || this.settleT < T.SETTLE_DUR || this.pitchSpdNow > 0;
    }
    this.write();
    const ms = performance.now() - t0; this.stats.ticks++; this.stats.msAvg += (ms - this.stats.msAvg) / Math.min(this.stats.ticks, 200);
    return true;
  }

  // ── input ──
  markFlying() {
    const now = performance.now();
    this.flyingSince ||= now;
    if (now - this.flyingSince > 200) document.body.classList.add('flying');
    clearTimeout(this.flyingTimer);
    this.flyingTimer = setTimeout(() => { document.body.classList.remove('flying'); this.flyingSince = 0; }, 4000);
  }
  syncInputActive() { document.body.classList.toggle('input-active', this.pointers.size > 0 || this.joyId !== null); }
  clearInputs() {
    for (const c in this.keys) this.keys[c] = false;
    this.sprintHeld = false; this.setBoost(false);
    this.joyFwd = 0; this.joyStrafe = 0; this.joyId = null;
    if (this.opts.joystick?.knob) this.opts.joystick.knob.style.transform = '';
    this.pointers.clear(); this.lookId = null; this.tapDragId = null; this.pinchDist = null;
    this.pendingYaw = this.pendingPitch = this.wheelLogAcc = this.touchLogAcc = 0;
    this.inputLatch = false; this.vel.e = 0; this.vel.n = 0; this.lastTs = null;
    this.resetEffectsHard(); this.syncInputActive();
    this.canvas.style.cursor = 'crosshair';
  }
  setBoost(on) {
    this.boostOn = !!on;
    if (this.boostBtn) { this.boostBtn.classList.toggle('on', this.boostOn); this.boostBtn.setAttribute('aria-pressed', String(this.boostOn)); }
  }
  goHome() {
    if (!this.opts.home) return;
    this.clearInputs();
    if (this.wasDriving) { this.wasDriving = false; this.dispatchEvent({ type: 'end' }); }
    this.opts.home(FLY.HOME_MS);
  }
  rebasePinch() {
    const p = [...this.pointers.values()];
    if (p.length >= 2) { this.pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); this.pinchCy = (p[0].y + p[1].y) / 2; } else this.pinchDist = null;
  }

  bind() {
    const cv = this.canvas, touchy = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';
    const L = (t, type, fn, o) => { t.addEventListener(type, fn, o); (this.unbind ||= []).push(() => t.removeEventListener(type, fn, o)); };
    L(cv, 'pointerdown', (e) => {
      if (!this.enabled) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.inputLatch = true; this.syncInputActive();
      e.preventDefault();
      if (this.pointers.size >= 2) { this.lookId = null; this.tapDragId = null; this.rebasePinch(); return; }
      const now = performance.now();
      if (touchy(e) && now - this.lastTapAt < FLY.TAP_MS && Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY) < FLY.TAP_PX) { this.tapDragId = e.pointerId; this.lookId = null; }
      else this.lookId = e.pointerId;
      this.lastTapAt = now; this.lastTapX = e.clientX; this.lastTapY = e.clientY;
      cv.style.cursor = 'grabbing';
      this.markFlying();
    });
    L(cv, 'pointermove', (e) => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size >= 2) {
        const q = [...this.pointers.values()], d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y), cy = (q[0].y + q[1].y) / 2;
        if (this.pinchDist != null && d > 0) { this.touchLogAcc += Math.log(this.pinchDist / d); this.touchLogAcc += -(cy - this.pinchCy) * FLY.PAN2_GAIN; }
        this.pinchDist = d; this.pinchCy = cy; this.markFlying(); return;
      }
      if (e.pointerId === this.tapDragId) { this.touchLogAcc += -dy * FLY.TAPDRAG_GAIN; this.markFlying(); return; }
      if (e.pointerId !== this.lookId) return;
      const touch = touchy(e);
      const mx = (!touch && e.movementX != null) ? e.movementX : dx, my = (!touch && e.movementY != null) ? e.movementY : dy;
      if (Math.abs(mx) >= FLY.LOOK_DEADZONE) this.pendingYaw += mx * (touch ? FLY.SENS_YAW_TOUCH : FLY.SENS_YAW_MOUSE) * this.lookScale;
      if (Math.abs(my) >= FLY.LOOK_DEADZONE) this.pendingPitch += my * (touch ? FLY.SENS_PITCH_TOUCH : FLY.SENS_PITCH_MOUSE) * this.lookScale;
      this.markFlying();
    });
    const release = (e) => {
      this.pointers.delete(e.pointerId); this.syncInputActive();
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
      if (e.pointerId === this.tapDragId) this.tapDragId = null;
      if (e.pointerId === this.lookId) this.lookId = null;
      if (this.pointers.size === 1) { this.lookId = [...this.pointers.keys()][0]; this.tapDragId = null; this.pinchDist = null; }
      else if (this.pointers.size >= 2) this.rebasePinch();
      else { this.pinchDist = null; this.lookId = null; this.tapDragId = null; cv.style.cursor = 'crosshair'; }
    };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) L(cv, t, release);
    L(cv, 'wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      let px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
      px = clamp(px, -240, 240);
      this.wheelLogAcc += -px * FLY.WHEEL_GAIN;
      this.markFlying();
    }, { passive: false });
    L(cv, 'contextmenu', (e) => e.preventDefault());
    L(window, 'keydown', (e) => {
      this.sprintHeld = e.shiftKey;
      if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      if (textTarget(e.target)) return;
      if (stepTarget(e.target) && STEP_CODES.includes(e.code)) return;
      if (e.code === 'KeyR') { this.goHome(); e.preventDefault(); return; }
      if (!MOVE_CODES.includes(e.code)) return;
      this.keys[e.code] = true; this.inputLatch = true;
      e.preventDefault(); this.markFlying();
    });
    L(window, 'keyup', (e) => { this.sprintHeld = e.shiftKey; this.keys[e.code] = false; });   // always release (controls.js 1471-1484)
    const blur = () => this.clearInputs();
    L(window, 'blur', blur); L(window, 'pagehide', blur);
    L(document, 'visibilitychange', () => { if (document.hidden) this.clearInputs(); });
    cv.style.touchAction = 'none'; cv.style.cursor = 'crosshair';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.classList.toggle('has-touch', navigator.maxTouchPoints > 0);

    // the joystick and BOOST (controls.js 1219-1276, 1912-1951): their own pointer capture, so a thumb on the stick is never a pinch finger
    const J = this.opts.joystick;
    if (J && J.base) {
      const btn = this.boostBtn = document.createElement('button');
      btn.id = 'joy-boost'; btn.type = 'button'; btn.setAttribute('aria-label', 'Boost speed'); btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l7-7 7 7"/><path d="M5 19l7-7 7 7"/></svg><b>BOOST</b>';
      (J.zone || J.base.parentElement).appendChild(btn);
      L(btn, 'pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.setBoost(!this.boostOn); this.markFlying(); });
      L(btn, 'click', (e) => { e.preventDefault(); e.stopPropagation(); });
      const joySet = (nx, ny) => {
        const r = Math.hypot(nx, ny);
        if (r <= FLY.JOY_DEAD) { this.joyFwd = 0; this.joyStrafe = 0; return; }
        const c = Math.pow((r - FLY.JOY_DEAD) / (1 - FLY.JOY_DEAD), FLY.JOY_EXPO) / r;
        this.joyStrafe = nx * c; this.joyFwd = ny * c;
      };
      J.base.style.touchAction = 'none';
      L(J.base, 'pointerdown', (e) => {
        if (this.joyId !== null) return;
        this.joyId = e.pointerId;
        try { J.base.setPointerCapture(e.pointerId); } catch (err) {}
        const r = J.base.getBoundingClientRect(); this.joyOx = r.left + r.width / 2; this.joyOy = r.top + r.height / 2;
        this.inputLatch = true; this.syncInputActive();
        e.preventDefault(); e.stopPropagation(); this.markFlying();
      });
      L(J.base, 'pointermove', (e) => {
        if (e.pointerId !== this.joyId) return;
        const rx = e.clientX - this.joyOx, ry = e.clientY - this.joyOy, capped = Math.min(Math.hypot(rx, ry), FLY.JOY_RADIUS), a = Math.atan2(ry, rx);
        const kx = Math.cos(a) * capped, ky = Math.sin(a) * capped;
        if (J.knob) J.knob.style.transform = `translate(${kx}px, ${ky}px)`;
        joySet(kx / FLY.JOY_RADIUS, -ky / FLY.JOY_RADIUS);
        e.preventDefault(); e.stopPropagation(); this.markFlying();
      });
      const up = (e) => {
        if (e.pointerId !== this.joyId) return;
        this.joyId = null; this.joyFwd = 0; this.joyStrafe = 0; this.syncInputActive();
        if (J.knob) J.knob.style.transform = '';
        try { J.base.releasePointerCapture(e.pointerId); } catch (err) {}
      };
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) L(J.base, t, up);
    }
  }

  // for the verify scripts: the state and every derived value
  state() {
    return { x: this.eye.x, z: this.eye.z, alt: this.alt, altUser: this.altUser, altFloor: this.altFloor, vE: this.vel.e, vN: this.vel.n,
      bearing: this.bearing, pitch: this.pitch, driving: this.wasDriving, roll: this.rollNow, fovKick: this.fovKickNow, boost: this.boostOn,
      speedBase: clamp(FLY.SPEED_REF * Math.pow(this.alt / FLY.ALT_REF, FLY.SPEED_EXP), FLY.SPEED_MIN, FLY.SPEED_MAX), lookScale: this.lookScale,
      field: { ready: this.field.ready, polys: this.field.polys.length, trunkBuckets: this.field.trunks.size }, tickMs: this.stats.msAvg };
  }

  dispose() { for (const u of this.unbind || []) u(); this.boostBtn?.remove(); }
}
