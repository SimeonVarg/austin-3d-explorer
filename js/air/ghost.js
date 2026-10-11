/**
 * ghost.js — a run in a URL, no server.
 *
 * The recorder samples the craft's position at AIR.ghost.hz (5 Hz) in the
 * local frame. Each sample is PREDICTED from the two before it (constant
 * velocity), and only the miss is stored, in AIR.ghost.quantM steps, closed
 * loop: the predictor runs on the DECODED values, so quantisation error never
 * accumulates (each decoded sample is within quantM/2 per axis of the true
 * one). Misses are small, so they pack as 4-bit nibbles (zigzag; 15 escapes to
 * a 3-bit-per-nibble varint). Orientation is NOT stored: the ghost flies along
 * its own path, so heading, pitch and bank come from the path's tangent and
 * curvature.
 *
 *   header (nibble varints): version, course id, hz, quant (dm), time (cs),
 *                            misses, sample count, first sample x, y, z (m)
 *   body:                     3 residual values per sample after the first
 *   wire:                     base64url, no padding
 *
 * decode(str) -> { meta, pts:[{t,x,y,z}] }, sampleAt(ghost, t) -> pose.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./params.js'), require('./geo.js'));
  else root.AirGhost = factory(root.AIR, root.AirGeo);
})(typeof self !== 'undefined' ? self : this, function (AIR, G) {
  'use strict';
  const VERSION = 1;
  const zig = n => (n << 1) ^ (n >> 31), unzig = u => (u >>> 1) ^ -(u & 1);

  class Nibbles {
    constructor() { this.a = []; }
    put(n) { this.a.push(n & 15); }
    /** unsigned varint, 3 data bits + continue bit per nibble */
    uvar(u) { do { let d = u & 7; u >>>= 3; this.put(d | (u ? 8 : 0)); } while (u); }
    /** signed value as a body residual: one nibble when small, else escape + varint */
    sval(n) { const z = zig(n); if (z < 15) this.put(z); else { this.put(15); this.uvar(z - 15); } }
    bytes() { const out = new Uint8Array((this.a.length + 1) >> 1); this.a.forEach((v, i) => { out[i >> 1] |= (i & 1) ? v : v << 4; }); return out; }
  }
  class Reader {
    constructor(bytes, count) { this.b = bytes; this.i = 0; this.n = count; }
    get() { if ((this.i >> 1) >= this.b.length) throw new Error('ghost: truncated'); const v = (this.b[this.i >> 1] >> ((this.i & 1) ? 0 : 4)) & 15; this.i++; return v; }
    uvar() { let u = 0, s = 0, d; do { d = this.get(); u |= (d & 7) << s; s += 3; } while (d & 8); return u >>> 0; }
    sval() { const n = this.get(); return n < 15 ? unzig(n) : unzig(this.uvar() + 15); }
  }
  const b64 = bytes => { let s = ''; for (const c of bytes) s += String.fromCharCode(c);
    return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64 = str => { const t = str.replace(/-/g, '+').replace(/_/g, '/'); const p = t + '==='.slice((t.length + 3) % 4);
    const bin = typeof atob === 'function' ? atob(p) : Buffer.from(p, 'base64').toString('binary'); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };

  /**
   * samples: [{x,y,z}] already at `hz` (sample k is at t = k / hz).
   * meta: { course:int, time:seconds, misses:int }
   */
  function encode(samples, meta, opts) {
    const Q = (opts && opts.quantM) || AIR.ghost.quantM, hz = (opts && opts.hz) || AIR.ghost.hz;
    const nb = new Nibbles();
    nb.uvar(VERSION); nb.uvar(meta.course | 0); nb.uvar(hz); nb.uvar(Math.round(Q * 10));
    nb.uvar(Math.round(meta.time * 100)); nb.uvar(meta.misses | 0); nb.uvar(samples.length);
    const dec = [];    // decoded values in quantum units: the predictor must see exactly what the decoder will
    const q = v => Math.round(v / Q);
    const first = samples[0];
    const f = [q(first.x), q(first.y), q(first.z)];
    f.forEach(v => nb.uvar(zig(v)));
    dec.push(f);
    for (let k = 1; k < samples.length; k++) {
      const s = samples[k], out = [];
      for (let a = 0; a < 3; a++) {
        const key = a === 0 ? 'x' : a === 1 ? 'y' : 'z';
        const pred = k === 1 ? dec[0][a] : 2 * dec[k - 1][a] - dec[k - 2][a];
        const val = q(s[key]), res = val - pred;
        nb.sval(res); out.push(pred + res);
      }
      dec.push(out);
    }
    return b64(nb.bytes());
  }

  function decode(str) {
    const bytes = unb64(str), r = new Reader(bytes);
    const version = r.uvar(); if (version !== VERSION) throw new Error('ghost: unknown version ' + version);
    const course = r.uvar(), hz = r.uvar(), Q = r.uvar() / 10, time = r.uvar() / 100, misses = r.uvar(), n = r.uvar();
    if (n < 2 || n > 20000 || !hz) throw new Error('ghost: bad header');
    const dec = [[unzig(r.uvar()), unzig(r.uvar()), unzig(r.uvar())]];
    for (let k = 1; k < n; k++) {
      const out = [];
      for (let a = 0; a < 3; a++) { const pred = k === 1 ? dec[0][a] : 2 * dec[k - 1][a] - dec[k - 2][a]; out.push(pred + r.sval()); }
      dec.push(out);
    }
    const pts = dec.map((v, k) => ({ t: k / hz, x: v[0] * Q, y: v[1] * Q, z: v[2] * Q }));
    return { meta: { version, course, hz, quantM: Q, time, misses, n }, pts };
  }

  /** Catmull-Rom position and tangent at time t (seconds since GO). */
  function sampleAt(g, t) {
    const pts = g.pts, hz = g.meta.hz, n = pts.length;
    const f = Math.max(0, Math.min(n - 1.0001, t * hz)), k = Math.floor(f), u = f - k;
    const p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[Math.min(n - 1, k + 1)], p3 = pts[Math.min(n - 1, k + 2)];
    const cr = (a, b, c, d, u, deriv) => deriv
      ? 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * u + 3 * (-a + 3 * b - 3 * c + d) * u * u)
      : 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    const x = cr(p0.x, p1.x, p2.x, p3.x, u), y = cr(p0.y, p1.y, p2.y, p3.y, u), z = cr(p0.z, p1.z, p2.z, p3.z, u);
    const dx = cr(p0.x, p1.x, p2.x, p3.x, u, 1) * hz, dy = cr(p0.y, p1.y, p2.y, p3.y, u, 1) * hz, dz = cr(p0.z, p1.z, p2.z, p3.z, u, 1) * hz;
    const sp = Math.hypot(dx, dy, dz) || 1, hs = Math.hypot(dx, dy) || 1;
    const yaw = G.wrap360(Math.atan2(dx, dy) / G.RAD), pitch = Math.atan2(dz, hs) / G.RAD;
    return { t, x, y, z, yaw, pitch, speed: sp, dx, dy, dz };
  }
  /** Bank from the path's turn rate: the ghost banks the way the model would (roll ~ yaw rate). */
  function bankAt(g, t) {
    const a = sampleAt(g, t - 0.25), b = sampleAt(g, t + 0.25);
    const dy = G.wrap180(b.yaw - a.yaw) / 0.5;           // deg/s
    const F = AIR.flight;
    const s = Math.max(-1, Math.min(1, dy / F.yawRateMax));
    return Math.asin(s * Math.sin(F.rollMax * G.RAD)) / G.RAD;
  }
  return { encode, decode, sampleAt, bankAt, VERSION };
});
