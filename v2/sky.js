// The sky of a moment (2026-10-25, ?moment=..., off by default: without ?moment the app's light is Light B exactly as before).
//
// The owner's bar is "exact copies of my photo moments", and at his photo IMG_1778 the gap left after the renderer matched Blender
// was the LIGHT: the app has one fixed afternoon sky (Light B), the photo has a low WSW sun, cumulus and silver glass. This module
// makes the sky a function of the date and time (and a haze and a cloud layer):
//
//   1. the sun's position from the date and time in Austin (NOAA's solar position formulas, with refraction);
//   2. the clear sky's radiance from a physically based single-scattering atmosphere (Rayleigh + Mie aerosols + ozone; `haze` is
//      the aerosol amount), tabulated once per moment over (azimuth from the sun, elevation), and the sun's colour and strength
//      from the same atmosphere's transmittance along the sun's path;
//   3. a cloud layer (2D value-noise fbm on a plane at altitude, lit by that sun and sky), band-limited per octave by the pixel's
//      footprint so it cannot shimmer in a pan (rule 15), the same function in the shader and here (for the diffuse light);
//   4. the CALIBRATION LAYER is Light B: at the reference moment (Light B's own sun, 215 / 48 degrees, haze 1, no clouds) the model
//      sky's light on a level surface equals Light B's sky stops' per colour channel, and the sun equals Light B's sun. Every other
//      moment is the model's change from that reference, so the app's units (and LIGHT_B's gains for lighting and mirrors) stay.
//
// main.js turns a moment into the visible dome, the fog, the mirror environment, the diffuse light probe, the ground's bounce and
// the sun. Nothing here reads a photograph; a moment preset (v2/data/moments.json) is a time and a few numbers.
import * as THREE from 'three';

const D2R = Math.PI / 180;

// ── the sun's position (NOAA, from Meeus): compass azimuth (degrees from north, clockwise) and elevation (degrees, refracted) ──
export function sunPosition(utcMs, lat, lon) {
  const jd = utcMs / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * D2R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * D2R) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R));
  const y = Math.tan((eps * D2R) / 2) ** 2;
  const eqMin = (4 / D2R) * (y * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(M * D2R) + 4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R)
    - 0.5 * y * y * Math.sin(4 * L0 * D2R) - 1.25 * e * e * Math.sin(2 * M * D2R));
  const utcMin = (((utcMs % 86400000) + 86400000) % 86400000) / 60000;
  const ha = ((utcMin + eqMin + 4 * lon) / 4 - 180) * D2R;
  const la = lat * D2R;
  const cz = THREE.MathUtils.clamp(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha), -1, 1);
  let el = 90 - Math.acos(cz) / D2R;
  const az = ((Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) / D2R + 180) % 360 + 360) % 360;
  if (el > -1) el += 1.02 / Math.tan((el + 10.3 / (el + 5.11)) * D2R) / 60;   // refraction (Saemundsson), arc minutes -> degrees
  return { az, el };
}

// "2026-10-24T17:07" (Austin's clock) -> UTC ms. America/Chicago's offset from the browser's own time-zone tables.
export function austinToUtc(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?$/.exec(s);
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const off = (utc) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utc;
  };
  let utc = guess - off(guess);
  utc = guess - off(utc);
  return utc;
}

// ── the atmosphere: single scattering, tabulated per moment ──────────────────────────────────────────────────────────────────
// Bruneton & Neyret's Earth (2008/2017 reference values), metres. Radiance is for a sun of irradiance 1 at the top of the atmosphere.
const ATM = {
  RE: 6360e3, RA: 6460e3, H0: 200,                        // ground radius, top, the eye's height above sea level (Austin ~150-200 m)
  BR: [5.802e-6, 13.558e-6, 33.1e-6], HR: 8000,            // Rayleigh scattering at sea level (680 / 550 / 440 nm), scale height
  // Mie (aerosol) scattering at sea level x haze (haze 1 = aerosol optical depth 0.1 at 550 nm, a usual Austin afternoon), extinction /
  // scattering, scale height, asymmetry
  BM: 7.5e-5, MIE_EXT: 1.11, HM: 1200, G: 0.8,
  BO: [0.65e-6, 1.881e-6, 0.085e-6], OZ_C: 25000, OZ_W: 15000,   // ozone absorption (peak density's), tent profile centre / half-width
};
export const SKY_TABLE = { NPHI: 128, NEL: 64, VIEW_STEPS: 24, SUN_STEPS: 10 };

function raySphere(oy, dy, R) {           // eye at (0, oy, 0) from the earth's centre, unit direction with vertical part dy: distance to the sphere
  const b = oy * dy, c = oy * oy - R * R, disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc), t0 = -b - s, t1 = -b + s;
  return t0 > 0 ? t0 : t1 > 0 ? t1 : -1;
}
// optical depth (Rayleigh, Mie, ozone densities integrated, metres) from a point at radius r, along a direction with cos(zenith) mu
function opticalDepth(r, mu, steps) {
  const groundHit = raySphere(r, mu, ATM.RE);
  if (groundHit > 0 && mu < 0) return null;                // the sun is below this point's horizon: it sees no sun
  const L = raySphere(r, mu, ATM.RA);
  if (L <= 0) return [0, 0, 0];
  let dR = 0, dM = 0, dO = 0;
  const ds = L / steps;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds, h = Math.sqrt(r * r + t * t + 2 * r * t * mu) - ATM.RE;
    dR += Math.exp(-h / ATM.HR) * ds; dM += Math.exp(-h / ATM.HM) * ds; dO += Math.max(0, 1 - Math.abs(h - ATM.OZ_C) / ATM.OZ_W) * ds;
  }
  return [dR, dM, dO];
}
const trans = (d, haze, c) => Math.exp(-(ATM.BR[c] * d[0] + ATM.BM * haze * ATM.MIE_EXT * d[1] + ATM.BO[c] * d[2]));
// the sun's transmittance from the top of the atmosphere to the eye (rgb), for the sun's elevation in degrees
export function sunTransmittance(elDeg, haze) {
  const d = opticalDepth(ATM.RE + ATM.H0, Math.sin(elDeg * D2R), 64);
  return d ? [0, 1, 2].map((c) => trans(d, haze, c)) : [0, 0, 0];
}
// The clear sky's radiance, (azimuth from the sun) x (elevation), rgb, for a sun of irradiance 1. Table axes are square-root mapped
// (u = sqrt(phi / pi), v = sqrt(el / 90 degrees)): fine near the sun's azimuth and near the horizon, where the sky changes fast.
// `ms` adds a share of light scattered more than once (isotropic, lit by the single-scattered sky's mean; 0 = single scattering).
export function skyTable(sunElDeg, haze, ms = 0) {
  const { NPHI, NEL, VIEW_STEPS, SUN_STEPS } = SKY_TABLE;
  const out = new Float32Array(NPHI * NEL * 4);
  const se = sunElDeg * D2R, s = [Math.cos(se), Math.sin(se), 0];
  const r0 = ATM.RE + ATM.H0, g = ATM.G, g2 = g * g;
  for (let j = 0; j < NEL; j++) {
    const el = (j / (NEL - 1)) ** 2 * (Math.PI / 2);
    for (let i = 0; i < NPHI; i++) {
      const phi = (i / (NPHI - 1)) ** 2 * Math.PI;
      const v = [Math.cos(el) * Math.cos(phi), Math.sin(el), Math.cos(el) * Math.sin(phi)];
      const mu = v[0] * s[0] + v[1] * s[1] + v[2] * s[2];
      const pR = (3 / (16 * Math.PI)) * (1 + mu * mu);
      const pM = (3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * mu, 1.5));
      const L = raySphere(r0, v[1], ATM.RA);
      let accR = [0, 0, 0], accM = [0, 0, 0], dR = 0, dM = 0, dO = 0, prevT = 0;
      for (let k = 0; k < VIEW_STEPS; k++) {
        const t = ((k + 0.5) / VIEW_STEPS) ** 2 * L, ds = ((k + 1) / VIEW_STEPS) ** 2 * L - (k / VIEW_STEPS) ** 2 * L;
        void prevT;
        const px = t * v[0], py = r0 + t * v[1], pz = t * v[2], r = Math.hypot(px, py, pz), h = r - ATM.RE;
        const rhoR = Math.exp(-h / ATM.HR), rhoM = Math.exp(-h / ATM.HM), rhoO = Math.max(0, 1 - Math.abs(h - ATM.OZ_C) / ATM.OZ_W);
        dR += rhoR * ds; dM += rhoM * ds; dO += rhoO * ds;
        const muS = (px * s[0] + py * s[1] + pz * s[2]) / r;
        const ds2 = opticalDepth(r, muS, SUN_STEPS);
        if (!ds2) continue;
        const tot = [dR + ds2[0], dM + ds2[1], dO + ds2[2]];
        for (let c = 0; c < 3; c++) {
          const T = trans(tot, haze, c);
          accR[c] += rhoR * T * ds; accM[c] += rhoM * T * ds;
        }
      }
      const o = (j * NPHI + i) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = ATM.BR[c] * pR * accR[c] + ATM.BM * haze * pM * accM[c];
      out[o + 3] = 1;
    }
  }
  if (ms > 0) {     // a cheap stand-in for multiple scattering: the sky's own mean radiance, times ms, added everywhere
    const mean = [0, 0, 0];   // over the solid angle of the upper half of the sky (the table's axes are square-root mapped)
    let wsum = 0;
    for (let j = 0; j < NEL; j++) for (let i = 0; i < NPHI; i++) {
      const v = j / (NEL - 1), u = i / (NPHI - 1), w = Math.cos(v * v * (Math.PI / 2)) * (v + 0.5 / NEL) * (u + 0.5 / NPHI);
      wsum += w; for (let c = 0; c < 3; c++) mean[c] += out[(j * NPHI + i) * 4 + c] * w;
    }
    for (let c = 0; c < 3; c++) mean[c] /= wsum;
    for (let k = 0; k < NPHI * NEL; k++) for (let c = 0; c < 3; c++) out[k * 4 + c] += ms * mean[c];
  }
  return out;
}
export function tableAt(tab, d, sunXZ) {          // d: unit direction (app frame), sunXZ: [x, z] of the sun's horizontal direction (unit)
  const { NPHI, NEL } = SKY_TABLE;
  const h = Math.hypot(d[0], d[2]);
  const cphi = h > 1e-6 ? THREE.MathUtils.clamp((d[0] * sunXZ[0] + d[2] * sunXZ[1]) / h, -1, 1) : 1;
  const u = Math.sqrt(Math.acos(cphi) / Math.PI) * (NPHI - 1), v = Math.sqrt(Math.max(0, Math.asin(THREE.MathUtils.clamp(d[1], 0, 1))) / (Math.PI / 2)) * (NEL - 1);
  const i0 = Math.min(NPHI - 2, Math.floor(u)), j0 = Math.min(NEL - 2, Math.floor(v)), fu = u - i0, fv = v - j0;
  const at = (i, j, c) => tab[(j * NPHI + i) * 4 + c];
  return [0, 1, 2].map((c) => (at(i0, j0, c) * (1 - fu) + at(i0 + 1, j0, c) * fu) * (1 - fv) + (at(i0, j0 + 1, c) * (1 - fu) + at(i0 + 1, j0 + 1, c) * fu) * fv);
}

// ── clouds: the same value-noise fbm in GLSL (cloudGLSL) and in JS (cloudAt) ─────────────────────────────────────────────────
function hash2(x, y) {
  let h = (Math.imul(x >>> 0, 0x8da6b343) ^ Math.imul(y >>> 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967295;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), X = ix + 32768, Y = iy + 32768;
  const a = hash2(X, Y), b = hash2(X + 1, Y), c = hash2(X, Y + 1), d = hash2(X + 1, Y + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
// cloud cover (0..1) in direction d: the layer's plane at ALT_M, features of SIZE_M, OCTAVES octaves, shifted by OFFSET (metres)
export function cloudAt(C, d) {
  if (d[1] <= 0.0) return 0;
  const k = C.ALT_M / Math.max(d[1], C.MIN_SIN) / C.SIZE_M;
  let x = d[0] * k + C.OFFSET[0] / C.SIZE_M, y = d[2] * k + C.OFFSET[1] / C.SIZE_M, f = 0, a = 0.5;
  for (let o = 0; o < C.OCTAVES; o++) { f += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 - 9.7; a *= 0.5; }
  f /= 1 - Math.pow(0.5, C.OCTAVES);
  const t = C.T;
  const den = THREE.MathUtils.smoothstep(f, t, t + C.SOFT);
  return den * THREE.MathUtils.smoothstep(d[1], C.HORIZON[0], C.HORIZON[1]);
}
// the noise level above which a point is cloud, so that COVER is the real share of the sky covered (the fbm's own quantile)
let fbmSorted = null;
function coverThreshold(C) {
  if (C.COVER <= 0) return 2;
  if (!fbmSorted || fbmSorted.oct !== C.OCTAVES) {
    const v = new Float64Array(8192);
    for (let k = 0; k < v.length; k++) {
      let x = (k % 128) * 0.731 + 0.123, y = Math.floor(k / 128) * 0.917 + 0.457, f = 0, a = 0.5;
      for (let o = 0; o < C.OCTAVES; o++) { f += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 - 9.7; a *= 0.5; }
      v[k] = f / (1 - Math.pow(0.5, C.OCTAVES));
    }
    v.sort(); fbmSorted = { v, oct: C.OCTAVES };
  }
  const v = fbmSorted.v, q = v[Math.min(v.length - 1, Math.max(0, Math.round((1 - C.COVER) * (v.length - 1))))];
  return q - C.SOFT / 2;
}
export const cloudGLSL = /* glsl */`
uint v2hash(uvec2 p) { uint h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u); h = (h ^ (h >> 13u)) * 0x2c1b3c6du; h ^= h >> 15u; return h; }
float v2vnoise(vec2 p) {
  vec2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  uvec2 I = uvec2(ivec2(i) + 32768);
  float a = float(v2hash(I)) / 4294967295.0, b = float(v2hash(I + uvec2(1u, 0u))) / 4294967295.0;
  float c = float(v2hash(I + uvec2(0u, 1u))) / 4294967295.0, d = float(v2hash(I + uvec2(1u, 1u))) / 4294967295.0;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// cover (0..1); each octave fades to its mean (0.5) as it nears the pixel's footprint: band-limited, not blurred (rule 15)
float v2cloud(vec3 d, vec4 cA, vec4 cB, vec2 cH) {
  // cA: alt / size, cover, soft, min sine; cB: offset.xy / size, octaves, (unused); cH: horizon fade sines
  vec2 p = d.xz * (cA.x / max(d.y, cA.w)) + cB.xy;
  vec2 w = fwidth(p);                                   // (before any branch: derivatives need every pixel of the quad)
  float fw = max(w.x, w.y);
  if (d.y <= 0.0 || cA.y > 1.5) return 0.0;
  float f = 0.0, a = 0.5, norm = 0.0;
  for (int o = 0; o < 8; o++) {
    if (float(o) >= cB.z) break;
    float fade = 1.0 - smoothstep(0.25, 0.5, fw);
    f += a * mix(0.5, v2vnoise(p), fade);
    norm += a;
    p = p * 2.03 + vec2(17.1, -9.7); fw *= 2.03; a *= 0.5;
  }
  f /= norm;
  float t = cA.y;   // the threshold (sky.js coverThreshold)
  return smoothstep(t, t + cA.z, f) * smoothstep(cH.x, cH.y, d.y);
}`;
// the colour of a cloud seen in direction d: lit by the sun (forward scattering toward the sun: bright edges) and the sky; denser = darker base
export function cloudColor(C, M, d, den) {
  const mu = d[0] * M.sunDir[0] + d[1] * M.sunDir[1] + d[2] * M.sunDir[2];
  const hg = (1 - C.G * C.G) / Math.pow(1 + C.G * C.G - 2 * C.G * mu, 1.5) / (4 * Math.PI);
  const lit = M.sunCloud.map((v) => v * (C.SUN + C.SILVER * hg) * (1 - C.BASE_DARK * den));
  return lit.map((v, c) => v + C.AMBIENT * M.skyMean[c]);
}

// ── a moment: everything main.js needs, in the app's units (dome units: the visible sky's, before LIGHT_B's gains) ─────────
// M = { utcMs, az, el, haze, clouds: {...cover}, exposure }; L = LOOK (SKY_STOPS etc.), lin255 = sRGB -> linear helper
export function buildMoment(spec, LOOK, ORIGIN, lin255) {
  const MO = LOOK.MOMENT;
  const C = { ...MO.CLOUDS, ...(spec.clouds || {}) };
  if (spec.cover != null) C.COVER = spec.cover;
  C.T = coverThreshold(C);
  const haze = spec.haze ?? MO.HAZE;
  let az = spec.az, el = spec.el;
  if (az == null || el == null) { const p = sunPosition(spec.utcMs, ORIGIN.lat, ORIGIN.lon); az ??= p.az; el ??= p.el; }
  const sunDir = [Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R)];
  const sunXZ = [Math.sin(az * D2R), -Math.cos(az * D2R)];
  const ms = spec.ms ?? MO.MULTI_SCATTER;
  // the calibration (Light B): the reference sky's light on a level surface vs the stops', per channel; the sun vs SUN_STRENGTH x LIGHT_B.sun
  const ref = calibration(LOOK, lin255, ms);
  // the photo's CAMERA (not the sky): its white balance, gains per channel with green 1, applied to every light (= to everything
  // the camera sees that is lit); exposure is applied by main.js as the tone mapper's exposure
  const wb = spec.wb || [1, 1, 1];
  const tab = skyTable(el, haze, ms);
  for (let k = 0; k < tab.length; k += 4) for (let c = 0; c < 3; c++) tab[k + c] *= ref.K[c] * wb[c];
  const Tm = sunTransmittance(el, haze), sunB = LOOK.SUN_STRENGTH.map((v) => v * LOOK.LIGHT_B.sun);
  const sunRGB = sunB.map((v, c) => (ref.T[c] > 0 ? (v * Tm[c]) / ref.T[c] : 0) * (spec.sun ?? 1) * wb[c]);
  // the sky's mean (zenith half) for the clouds' ambient, and the cloud's sunlight (the sun's colour, in dome units)
  const skyMean = [0, 0, 0];
  for (let j = 0; j < 16; j++) for (let i = 0; i < 32; i++) {
    const th = ((j + 0.5) / 16) * (Math.PI / 2), ph = ((i + 0.5) / 32) * 2 * Math.PI;
    const v = tableAt(tab, [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)], sunXZ);
    for (let c = 0; c < 3; c++) skyMean[c] += v[c] / 512;
  }
  const sunCloud = sunRGB.map((v) => v / sunB[1]);       // 1 = Light B's sun (green channel)
  const night = { ...MO.NIGHT, ...(spec.night || {}) };
  night.ZENITH = night.ZENITH.map((v, c) => v * wb[c]); night.GLOW = night.GLOW.map((v, c) => v * wb[c]);
  // the night floor: what single scattering leaves out after dusk (moonless airglow + the city's own glow on the haze)
  const nightK = 1 - THREE.MathUtils.smoothstep(el, night.FROM_EL[0], night.FROM_EL[1]);
  return { spec, az, el, haze, ms, sunDir, sunXZ, tab, sunRGB, sunCloud, skyMean, C, ref, nightK, night,
    exposure: spec.exposure ?? 1, wb, sunB };
}

let calibCache = null;
function calibration(LOOK, lin255, ms) {
  const key = JSON.stringify([LOOK.SKY_STOPS, LOOK.SUN_STRENGTH, LOOK.LIGHT_B, LOOK.MOMENT.REF, ms]);
  if (calibCache && calibCache.key === key) return calibCache;
  const R = LOOK.MOMENT.REF;
  const tab = skyTable(R.EL, R.HAZE, ms);
  const stops = LOOK.SKY_STOPS.map(([z, c]) => [z, lin255(c)]);
  const stopAt = (z) => { let c = stops[0][1]; for (let i = 1; i < stops.length; i++) if (z > stops[i - 1][0]) { const t = Math.min(1, (z - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])); c = stops[i - 1][1].map((v, k) => v + (stops[i][1][k] - v) * t); } return c; };
  const sunXZ = [Math.sin(R.AZ * D2R), -Math.cos(R.AZ * D2R)];
  const Em = [0, 0, 0], Eb = [0, 0, 0];
  const NT = 48, NP = 96;
  for (let j = 0; j < NT; j++) {
    const th = ((j + 0.5) / NT) * (Math.PI / 2), w = Math.cos(th) * Math.sin(th);
    for (let i = 0; i < NP; i++) {
      const ph = ((i + 0.5) / NP) * 2 * Math.PI, d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const m = tableAt(tab, d, sunXZ), b = stopAt(d[1]);
      for (let c = 0; c < 3; c++) { Em[c] += m[c] * w; Eb[c] += b[c] * w; }
    }
  }
  // ONE number for the sky (its luminance), not one per channel: Light B's stops are a very saturated blue that its per-channel SKY_GAIN
  // turns back into a lighting sky; per channel, that tint would turn the model's white haze and sun halo blue. The visible sky, the lit
  // sky and the mirror sky keep Light B's brightness relations (LIGHT = the lighting sky / the dome, in luminance; LIGHT_B.mirror).
  const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const k = lum(Eb) / lum(Em), sg = LOOK.SKY_GAIN.map((g) => g * LOOK.LIGHT_B.sky);
  calibCache = { key, K: [k, k, k], LIGHT: lum(Eb.map((v, c) => v * sg[c])) / lum(Eb), T: sunTransmittance(R.EL, R.HAZE) };
  return calibCache;
}

// the moment's sky (dome units, no clouds) and with clouds, in direction d (JS; for the light probe's projection)
export function momentSky(M, d) {
  const c = tableAt(M.tab, d, M.sunXZ);
  if (M.nightK > 0) { const n = nightSky(M, d); for (let k = 0; k < 3; k++) c[k] += n[k]; }
  const den = cloudAt(M.C, d);
  if (den <= 0) return c;
  const cc = cloudColor(M.C, M, d, den), a = den * M.C.OPACITY;
  return c.map((v, k) => v * (1 - a) + cc[k] * a);
}
function nightSky(M, d) {
  const N = M.night, up = Math.max(0, d[1]);
  const glow = Math.exp(-up / N.GLOW_SINE);
  return [0, 1, 2].map((c) => M.nightK * (N.ZENITH[c] + N.GLOW[c] * glow));
}
export const nightGLSL = /* glsl */`
vec3 v2night(vec3 d, float k, vec3 zen, vec3 glow, float gs) { return k * (zen + glow * exp(-max(d.y, 0.0) / gs)); }`;
