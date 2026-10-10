// No browser. Emulates the far pattern filter in js/city-lighting.js (cityPatternTexel) on a synthetic window
// grid and compares its two tap layouts against the exact box average over the pixel's footprint:
//   grid    = 4x4 regular comb, taps at most maxSpacing texels apart (the layout on main)
//   scatter = the same number of taps, spread over the whole footprint by a fixed low-discrepancy set
//   hybrid  = comb up to 8 texels, then the taps move continuously to the scattered set by 12 (?patscatter=1)
// The number is the RMS error (0..255) over many sub-texel offsets of the pixel centre, i.e. how much a pixel's
// colour differs from the right answer, and how far it swings as the camera slides. Lower is better.
// Usage: node pattern-filter-taps.mjs   (exits 1 if scatter is worse than grid at any footprint it claims to help)
const T = 64, tile = new Float32Array(T * T);
// a window grid: 16 x 20 texel cells, window 9 x 12 (dark) on a light wall, like a facade tile
for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) tile[y * T + x] = ((x % 16) < 9 && (y % 20) < 12) ? 40 : 200;
const texel = (x, y) => tile[(((y % T) + T) % T) * T + (((x % T) + T) % T)];
function bilinear(u, v) {                      // u,v in texels; texel centres at +.5
  const x = u - .5, y = v - .5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  return (texel(x0, y0) * (1 - fx) + texel(x0 + 1, y0) * fx) * (1 - fy) + (texel(x0, y0 + 1) * (1 - fx) + texel(x0 + 1, y0 + 1) * fx) * fy;
}
const MAXTAPS = 4, SPACING = 2;
function grid(cx, cy, Fx, Fy) {
  const nx = Math.min(MAXTAPS, Math.max(1, Math.ceil(Fx))), ny = Math.min(MAXTAPS, Math.max(1, Math.ceil(Fy)));
  if (nx * ny <= 1) return bilinear(cx, cy);
  const dx = Fx * Math.min(1, nx * SPACING / Math.max(Fx, 1e-4)), dy = Fy * Math.min(1, ny * SPACING / Math.max(Fy, 1e-4));
  let s = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) s += bilinear(cx + dx * ((i + .5) / nx - .5), cy + dy * ((j + .5) / ny - .5));
  return s / (nx * ny);
}
function scatter(cx, cy, Fx, Fy) {
  const nx = Math.min(MAXTAPS, Math.max(1, Math.ceil(Fx))), ny = Math.min(MAXTAPS, Math.max(1, Math.ceil(Fy))), n = nx * ny;
  if (n <= 1) return bilinear(cx, cy);
  let s = 0;
  for (let k = 0; k < n; k++) {
    const ux = (.5 + (k + 1) * .7548776662) % 1, uy = (.5 + (k + 1) * .5698402910) % 1;
    s += bilinear(cx + Fx * (ux - .5), cy + Fy * (uy - .5));
  }
  return s / n;
}
// the layout shipped behind ?patscatter=1: grid taps below SW0 texels, a continuous morph to scattered taps by SW1
const SW0 = 8, SW1 = 12, smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hybrid(cx, cy, Fx, Fy) {
  const nx = Math.min(MAXTAPS, Math.max(1, Math.ceil(Fx))), ny = Math.min(MAXTAPS, Math.max(1, Math.ceil(Fy))), n = nx * ny;
  if (n <= 1) return bilinear(cx, cy);
  const w = smooth(SW0, SW1, Math.max(Fx, Fy));
  const gx = Fx * Math.min(1, nx * SPACING / Math.max(Fx, 1e-4)), gy = Fy * Math.min(1, ny * SPACING / Math.max(Fy, 1e-4));
  let s = 0;
  for (let k = 0; k < n; k++) {
    const i = Math.floor(k / ny), j = k - i * ny;
    const px = gx * ((i + .5) / nx - .5), py = gy * ((j + .5) / ny - .5);
    const qx = Fx * (((.5 + (k + 1) * .7548776662) % 1) - .5), qy = Fy * (((.5 + (k + 1) * .5698402910) % 1) - .5);
    s += bilinear(cx + px + (qx - px) * w, cy + py + (qy - py) * w);
  }
  return s / n;
}
function truth(cx, cy, Fx, Fy) {               // exact box mean, 6 x 6 samples per texel
  const nx = Math.max(6, Math.ceil(Fx * 6)), ny = Math.max(6, Math.ceil(Fy * 6)); let s = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) s += texel(Math.floor(cx + Fx * ((i + .5) / nx - .5)), Math.floor(cy + Fy * ((j + .5) / ny - .5)));
  return s / (nx * ny);
}
let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
console.log('footprint (texels)   point    grid  scatter (RMS error vs exact box, 0..255)  hybrid');
let worse = 0;
for (const F of [1.5, 2, 3, 4, 6, 8, 12, 20, 40]) for (const [Fx, Fy] of [[F, F], [F, F * .4]]) {
  let e0 = 0, e1 = 0, e2 = 0, e3 = 0; const N = 600;
  for (let k = 0; k < N; k++) {
    const cx = rnd() * T, cy = rnd() * T, t = truth(cx, cy, Fx, Fy);
    e0 += (bilinear(cx, cy) - t) ** 2; e1 += (grid(cx, cy, Fx, Fy) - t) ** 2; e2 += (scatter(cx, cy, Fx, Fy) - t) ** 2; e3 += (hybrid(cx, cy, Fx, Fy) - t) ** 2;
  }
  const r = x => Math.sqrt(x / N);
  console.log(`${String(Fx.toFixed(1)).padStart(5)} x ${String(Fy.toFixed(1)).padEnd(5)}       ${r(e0).toFixed(1).padStart(6)}  ${r(e1).toFixed(1).padStart(6)}  ${r(e2).toFixed(1).padStart(7)}  ${r(e3).toFixed(1).padStart(7)}`);
  if (r(e3) > r(e1) * 1.02 + 0.05) worse++;
}
console.log(worse ? `FAIL: the hybrid layout is worse than the comb at ${worse} footprints` : 'PASS: the hybrid layout is no worse than the comb at any footprint, and far better beyond 8 texels');
process.exit(worse ? 1 : 0);
