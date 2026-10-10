// No browser. Emulates the far pattern filter in js/city-lighting.js (cityPatternTexel) on synthetic wall
// textures and compares its tap layouts against the exact box average over the pixel's footprint:
//   grid    = 4x4 regular comb, taps at most maxSpacing texels apart (the layout on main)
//   scatter = the same number of taps, spread over the whole footprint by a fixed low-discrepancy set
//   hybrid  = what ?patscatter=1 draws: comb up to scatterFrom texels, then each PIXEL picks the scattered set
//             with a probability that rises to 1 at scatterTo (a screen-space dither, no seam, no in-between taps)
// The number is the RMS error (0..255) over many sub-texel offsets of the pixel centre, i.e. how much a pixel's
// colour differs from the right answer, and how far it swings as the camera slides. Lower is better.
//
// THE SHADER CONSTANTS ARE READ FROM js/city-lighting.js, NOT COPIED: tap caps, spacing, the scattered set, the
// dither hash, the morph band. If the shader's tap code changes shape the emulation refuses to run (exit 1) so
// the maths here cannot silently describe a shader that no longer exists. CITY_LIGHTING=<file> points it at
// another copy of the source (used to check the test fails on the old layout).
//
// WHY THE MORPH IS A DITHER. An earlier layout slid every tap from its comb spot to its scattered spot over 8..12
// texels. The taps half-way along are neither a comb nor a scatter, and measured on this window grid that is WORSE
// THAN BOTH at 9 to 11 texels (comb 13.4, scatter 10.6, slid taps 21.7 at 10 x 10), and any slid blend is worse than
// the comb somewhere (the error bumps up between the two, by up to ~5 levels even in its best band). Where the comb
// is better than the scatter (under ~9 to 10 texels) the hybrid must be the comb; where it is worse it must not be
// worse than the comb. A per-pixel pick between the two gives exactly the mean of their squared errors, so it
// cannot be worse than the comb once the scatter is the better of the two.
//
// Usage: node pattern-filter-taps.mjs   (exits 1 if the hybrid is worse than the comb at any sampled footprint,
//                                        or if it fails to help far away, or if the shader no longer matches)
import fs from 'node:fs';

const SRC = process.env.CITY_LIGHTING || new URL('../../js/city-lighting.js', import.meta.url);
const src = fs.readFileSync(SRC, 'utf8');
const die = m => { console.error('FAIL: ' + m); process.exit(1); };
const grab = (re, what) => { const m = src.match(re); if (!m) die(`js/city-lighting.js no longer matches what this test emulates (${what}); update the emulation.`); return m; };

// ---- constants, read from the shader source -------------------------------------------------------------------
const MAXTAPS = +grab(/maxTaps:(\d+)/, 'patternFilter.maxTaps')[1];
const SPACING = +grab(/maxSpacing:([\d.]+)/, 'patternFilter.maxSpacing')[1];
const SW0 = +grab(/scatterFrom:([\d.]+)/, 'patternFilter.scatterFrom')[1];
const SW1 = +grab(/scatterTo:([\d.]+)/, 'patternFilter.scatterTo')[1];
const [, GA, GB] = grab(/fract\(vec2\(\.5\)\+\(float\(i\)\*ny\+float\(j\)\+1\.0\)\*vec2\(([\d.]+),([\d.]+)\)\)/, 'the scattered tap set');
const [GAx, GBy] = [+GA, +GB];
// the structure of the tap loop: the same expressions as the emulation below
grab(/vec2 gx=dx\*min\(1\.0,nx\*u_cityPatternFilterB\.x\/max\(fx,1e-4\)\);/, 'comb spread gx');
grab(/vec2 at=v\+gx\*\(\(float\(i\)\+\.5\)\/nx-\.5\)\+gy\*\(\(float\(j\)\+\.5\)\/ny-\.5\);/, 'comb tap position');
grab(/at=mix\(at,v\+dx\*q\.x\+dy\*q\.y,w\);/, 'scattered tap position');
grab(/if\(w>0\.0\)\{/, 'the w>0 branch (off = the comb, untouched)');
grab(/nx\*ny<=1\.0\)return point/, 'the one-tap early return');
// the switch: off by default, and off means w == 0
grab(/scatter:\/\[\?&\]patscatter=1\/\.test\(location\.search\)/, 'the switch is read from ?patscatter=1 and is not on by default');
grab(/u_cityPatternFilterB\.value\.set\(patternFilter\.maxSpacing,patternFilter\.scatter\?1:0/, 'the uniform carries scatter?1:0');
grab(/float w=u_cityPatternFilterB\.y\*/, 'w is multiplied by the switch, so off gives exactly 0');
const usesBand = /\$\{patternFilter\.scatterFrom\.toFixed\(1\)\},\$\{patternFilter\.scatterTo\.toFixed\(1\)\}/.test(src);
if (!usesBand) die('the weight no longer uses patternFilter.scatterFrom / scatterTo');
// how the weight is built: a position slide (old) or a per-pixel pick (dither)
const dither = /float h=fract\(([\d.]+)\*fract\(dot\(gl_FragCoord\.xy,vec2\(([\d.]+),([\d.]+)\)\)\)\);/.exec(src);
let H = null;
if (dither) {
  grab(/float w=u_cityPatternFilterB\.y\*step\(h\+1e-5,smoothstep\(\$\{patternFilter\.scatterFrom\.toFixed\(1\)\},\$\{patternFilter\.scatterTo\.toFixed\(1\)\},max\(fx,fy\)\)\);/, 'the dithered weight');
  const [, m, a, b] = dither; H = { m: +m, a: +a, b: +b };
} else {
  grab(/float w=u_cityPatternFilterB\.y\*smoothstep\(\$\{patternFilter\.scatterFrom\.toFixed\(1\)\},\$\{patternFilter\.scatterTo\.toFixed\(1\)\},max\(fx,fy\)\);/, 'the sliding weight');
}
const MODE = dither ? 'dither (per-pixel pick)' : 'slide (every tap moves part way)';
const fract = x => x - Math.floor(x);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- wall textures ---------------------------------------------------------------------------------------------
const mk = (T, fn) => { const tile = new Float32Array(T * T); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) tile[y * T + x] = fn(x, y); return { T, tile }; };
const WALLS = {
  // a window grid: 16 x 20 texel cells, window 9 x 12 (dark) on a light wall, like a facade tile
  'window 16x20': mk(64, (x, y) => ((x % 16) < 9 && (y % 20) < 12) ? 40 : 200),
  // a second grid with a different period, so the layout is not tuned to one pitch
  'window 12x15': mk(60, (x, y) => ((x % 12) < 7 && (y % 15) < 9) ? 40 : 200),
  // brick courses: a joint line every 8 rows, staggered joints every 16 columns
  'brick': mk(64, (x, y) => ((y % 8) < 1 || (((x + ((y >> 3) & 1) * 8) % 16) < 1)) ? 60 : 190),
};
function env({ T, tile }) {
  const texel = (x, y) => tile[(((y % T) + T) % T) * T + (((x % T) + T) % T)];
  function bilinear(u, v) {                      // u,v in texels; texel centres at +.5
    const x = u - .5, y = v - .5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return (texel(x0, y0) * (1 - fx) + texel(x0 + 1, y0) * fx) * (1 - fy) + (texel(x0, y0 + 1) * (1 - fx) + texel(x0 + 1, y0 + 1) * fx) * fy;
  }
  // the shader's tap loop; w = 0 is the comb, w = 1 the scattered set, between = every tap part way
  function taps(cx, cy, Fx, Fy, w) {
    const nx = Math.min(MAXTAPS, Math.max(1, Math.ceil(Fx))), ny = Math.min(MAXTAPS, Math.max(1, Math.ceil(Fy))), n = nx * ny;
    if (n <= 1) return bilinear(cx, cy);
    const gx = Fx * Math.min(1, nx * SPACING / Math.max(Fx, 1e-4)), gy = Fy * Math.min(1, ny * SPACING / Math.max(Fy, 1e-4));
    let s = 0;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(k / ny), j = k - i * ny;
      let px = cx + gx * ((i + .5) / nx - .5), py = cy + gy * ((j + .5) / ny - .5);
      if (w > 0) {
        const qx = Fx * (fract(.5 + (k + 1) * GAx) - .5), qy = Fy * (fract(.5 + (k + 1) * GBy) - .5);
        px += (cx + qx - px) * w; py += (cy + qy - py) * w;
      }
      s += bilinear(px, py);
    }
    return s / n;
  }
  function truth(cx, cy, Fx, Fy) {               // exact box mean, 6 x 6 samples per texel (3 x 3 past 12 texels, to keep it quick)
    const q = Math.max(Fx, Fy) > 12 ? 3 : 6, nx = Math.max(q, Math.ceil(Fx * q)), ny = Math.max(q, Math.ceil(Fy * q)); let s = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) s += texel(Math.floor(cx + Fx * ((i + .5) / nx - .5)), Math.floor(cy + Fy * ((j + .5) / ny - .5)));
    return s / (nx * ny);
  }
  return { bilinear, taps, truth };
}
// the weight the shader would compute for a pixel (screen position sx, sy), exactly as written in the source
function weight(F, sx, sy) {
  const p = smooth(SW0, SW1, F);
  if (!H) return p;
  const h = fract(H.m * fract(sx * H.a + sy * H.b));
  return (h + 1e-5 <= p) ? 1 : 0;               // step(h+1e-5, p)
}

let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
// 1.5..8 as before; then every half texel across the morph band and a little either side; then far
const FOOTS = [1.5, 2, 3, 4, 6, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 16, 20, 40];
const TOL_REL = 1.02, TOL_ABS = 0.05;
console.log(`morph: ${MODE}, comb up to ${SW0} texels, scatter from ${SW1}; maxTaps ${MAXTAPS}, spacing ${SPACING}  (constants read from ${typeof SRC === 'string' ? SRC : 'js/city-lighting.js'})`);
let bad = [], farBad = [], rows = 0;
for (const [wallName, wall] of Object.entries(WALLS)) {
  const { bilinear, taps, truth } = env(wall);
  console.log(`\n${wallName}: footprint (texels)   point    grid  scatter  hybrid   (RMS error vs exact box, 0..255)`);
  for (const F of FOOTS) for (const [Fx, Fy] of [[F, F], [F, F * .4]]) {
    let e0 = 0, e1 = 0, e2 = 0, e3 = 0;
    const N = F > 14 ? 300 : 1000;                 // samples of the pixel centre (fewer where the truth is expensive)
    for (let k = 0; k < N; k++) {
      const cx = rnd() * wall.T, cy = rnd() * wall.T, t = truth(cx, cy, Fx, Fy);
      const sx = Math.floor(rnd() * 4096) + .5, sy = Math.floor(rnd() * 4096) + .5;   // which screen pixel this is
      const c = taps(cx, cy, Fx, Fy, 0);                                              // same offsets for all three
      e0 += (bilinear(cx, cy) - t) ** 2; e1 += (c - t) ** 2; e2 += (taps(cx, cy, Fx, Fy, 1) - t) ** 2;
      e3 += (taps(cx, cy, Fx, Fy, weight(Math.max(Fx, Fy), sx, sy)) - t) ** 2;
    }
    const r = x => Math.sqrt(x / N), g = r(e1), s = r(e2), h = r(e3);
    const worse = h > g * TOL_REL + TOL_ABS;
    rows++;
    console.log(`${String(Fx.toFixed(1)).padStart(11)} x ${String(Fy.toFixed(1)).padEnd(5)}      ${r(e0).toFixed(1).padStart(6)}  ${g.toFixed(1).padStart(6)}  ${s.toFixed(1).padStart(7)}  ${h.toFixed(1).padStart(6)}${worse ? '   <-- WORSE THAN THE COMB' : ''}`);
    if (worse) bad.push(`${wallName} ${Fx.toFixed(1)}x${Fy.toFixed(1)}: hybrid ${h.toFixed(1)} vs comb ${g.toFixed(1)} (scatter ${s.toFixed(1)})`);
    if (wallName === 'window 16x20' && Fx >= 16 && h > g * 0.6) farBad.push(`${wallName} ${Fx.toFixed(1)}x${Fy.toFixed(1)}: hybrid ${h.toFixed(1)} is not clearly better than comb ${g.toFixed(1)}`);
  }
}
console.log('');
if (bad.length) console.log(`FAIL: the hybrid layout is worse than the comb at ${bad.length} of ${rows} cases:\n  ` + bad.join('\n  '));
if (farBad.length) console.log(`FAIL: the hybrid does not help far away (16+ texels, window 16x20 wall) at ${farBad.length} cases:\n  ` + farBad.join('\n  '));
if (!bad.length && !farBad.length) console.log(`PASS: the hybrid layout is no worse than the comb at any of ${rows} sampled cases (3 walls, square and 0.4 aspect, footprints 1.5 to 40 incl. every half texel from 8 to 13), and under 0.6 of the comb's error from 16 texels on (window 16x20)`);
process.exit(bad.length || farBad.length ? 1 : 0);
