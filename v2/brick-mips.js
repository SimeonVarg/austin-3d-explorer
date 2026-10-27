// Brick mip chain (rule 15: no moire, blur is not a fix) for the photo brick textures of scripts/v2/photo_materials.json.
//
// Why: a running bond's head joints are staggered by half a brick every course, so the joint pattern is a lattice whose strongest
// repeats run on the DIAGONALS. A plain box-filtered mip chain keeps those thin joints until the brick is only a few texels long,
// and sampled near that limit they fold into a diagonal cross-hatch (McCombs at its photo camera: course 2.4 px, brick 8 px). A
// positive mip bias only fades the whole wall, which the blur gate rightly refuses.
//
// What this makes instead, level by level from the photo (level 0 is the photo itself, untouched):
//   1. each level is a 2x decimation of the level above with a 4-tap binomial (wraps: the texture tiles);
//   2. VERTICAL JOINTS GO FIRST: once a brick (brick + head joint) is shorter than JOINT_NONE texels at a level, each row is
//      averaged along itself over exactly one brick length (fully at JOINT_FULL texels). What stays is each course's tone and the
//      bed joints: rows that read as horizontal lines, which cannot make a diagonal;
//   3. then the courses: once a course is shorter than COURSE_NONE texels, each column is averaged over exactly one course
//      (fully at COURSE_FULL), so a course never reaches the sampler at less than ~2 texels, where it would beat into bands.
//   Both averages are one period wide, so they remove the repeat and keep the photo's slower tone variation (a first version
//   flattened whole rows to their mean; the far wall then measured softer than the supersampled truth, v2-shimmer soft +0.10);
//   4. averaging is done in linear light (colour maps) so the far tone is the photo's true mean, not a darker sRGB mean.
// The course is measured from the texture itself (autocorrelation of its row profile: the bed joints), so every
// photo brick texture gets the right chain with no per-building number. No extra download: the chain is made in the browser at
// load (a few ms for 512 x 512) and the GPU memory is the same full chain it had before.
export const BRICK_MIPS = {
  JOINT_NONE: 20,   // brick length in texels at a level above which the head joints are kept as they are
  JOINT_FULL: 10,   // ... at or below which they are gone (rows = their own mean)
  COURSE_NONE: 4,   // course height in texels at a level above which the courses are kept
  COURSE_FULL: 2.5, // ... at or below which each column is averaged over one course (no course stripes left)
  BRICK_RATIO: 3.2, // brick + head joint, in courses
  MIN_PEAK: 0.15,   // autocorrelation peak a period must reach to count (else the texture is left to the GPU's own chain)
};

const smooth = (e0, e1, x) => { if (!(e1 > e0)) return 1; const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const L2S = new Uint8ClampedArray(4096);
for (let i = 0; i < 4096; i++) { const c = i / 4095; L2S[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }

// the period of a circular autocorrelation over lags [lo, hi]: its highest peak, or the smallest whole fraction of it (lag / n)
// whose every multiple up to the peak is itself a clear peak (Biological Laboratories: the bed joints repeat every course at
// 0.22, but the brick heights pair up, so every second/third course peaks higher). Returns [lag, normalised height].
function period(acf, lo, hi) {
  while (lo < hi && acf[lo + 1] < acf[lo]) lo++;   // skip the central lobe (neighbouring texels look alike): search after its first dip
  let best = -1, at = 0;
  for (let k = lo; k <= hi; k++) if (acf[k] > best) { best = acf[k]; at = k; }
  if (best <= 0) return [0, 0];
  const val = (x) => acf[Math.round(x)] / acf[0];
  const peakNear = (x) => { for (let k = Math.max(lo, Math.round(x) - 1); k <= Math.round(x) + 1; k++) if (acf[k] >= acf[k - 1] && acf[k] >= acf[k + 1]) return acf[k] / acf[0]; return -1; };
  for (let n = Math.floor(at / lo); n >= 2; n--) {   // every multiple a local peak of at least 0.35 x the highest, each a clear 0.15 above the valley before it
    let ok = true;
    for (let m = 1; ok && m < n; m++) { const p = peakNear(at * m / n); ok = p >= 0.35 * best / acf[0] && p - val(at * (m - 0.5) / n) >= 0.15; }
    if (ok) return [at / n, peakNear(at / n)];
  }
  return [at, best / acf[0]];
}

// lum: Float32Array w*h. Course = period of the row-mean profile (the bed joints); brick = course x BRICK_RATIO.
export function brickPeriods(lum, w, h) {
  const row = new Float64Array(h);
  // the row profile of the vertical second difference: the bed joints, with the course-to-course colour of polychrome brick
  // (Schoch: its colours repeat every 5 courses, which the plain row means took for the course) taken out
  for (let y = 0; y < h; y++) {
    const a = ((y - 2 + h) % h) * w, b = y * w, c = ((y + 2) % h) * w; let s = 0;
    for (let x = 0; x < w; x++) s += lum[b + x] - 0.5 * (lum[a + x] + lum[c + x]);
    row[y] = s / w;
  }
  let m = 0; for (let y = 0; y < h; y++) m += row[y]; m /= h; for (let y = 0; y < h; y++) row[y] -= m;
  const av = new Float64Array((h >> 1) + 2);
  for (let k = 0; k < av.length; k++) { let s = 0; for (let y = 0; y < h; y++) s += row[y] * row[(y + k) % h]; av[k] = s; }
  const [course, pv] = period(av, 3, (h >> 1));
  // the brick length is NOT measured along the rows: photo bricks vary in length, so that period is weak and was found wrong on
  // 5 of 8 textures; a modular brick is BRICK_RATIO courses long (Schoch 3.1, McCombs 3.35, measured from the photographs)
  const c = course ? h / Math.max(1, Math.round(h / course)) : 0;   // a whole number of courses per tile
  return { course: c, brick: c * BRICK_MIPS.BRICK_RATIO, peak: pv };
}

// a box exactly one period wide (fractional ends, wrapping: the texture tiles) along rows (u) or columns (v). Its zeros fall on
// every harmonic of that period, so it removes the repeat (the joints, the courses) and nothing slower: the photo's own tone
// variation across bricks and across the tile stays, which is what keeps the far wall as detailed as the truth (rule 15).
function boxAlong(d, w, h, W, alongU) {
  const n = alongU ? w : h, lines = alongU ? h : w, out = new Float32Array(w * h);
  if (W <= 1) { out.set(d); return out; }
  const C = new Float64Array(n + 1), line = new Float64Array(n);
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < n; i++) line[i] = d[alongU ? l * w + i : i * w + l];
    for (let i = 0; i < n; i++) C[i + 1] = C[i] + line[i];
    const tot = C[n];
    if (W >= n) { for (let i = 0; i < n; i++) out[alongU ? l * w + i : i * w + l] = tot / n; continue; }
    const S = (t) => { const q = Math.floor(t / n), r = t - q * n, k = Math.floor(r); return q * tot + C[k] + (r - k) * line[k]; };
    for (let i = 0; i < n; i++) out[alongU ? l * w + i : i * w + l] = (S(i + 0.5 + W / 2) - S(i + 0.5 - W / 2)) / W;
  }
  return out;
}
const blend = (d, e, t) => { for (let i = 0; i < d.length; i++) d[i] += t * (e[i] - d[i]); };

// rgba: Uint8(Clamped)Array w*h*4 (level 0). linear: false for sRGB colour maps (averaged in linear light), true for normal maps.
// Returns [{ data: Uint8ClampedArray, width, height }] from level 0 down to 1 x 1, or null when no brick period is found.
export function brickMipChain(rgba, w, h, { linear = false, periods = null, P = BRICK_MIPS } = {}) {
  const n = w * h, toL = linear ? (v) => v / 255 : (v) => S2L[v];
  let cur = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) cur[c][i] = toL(rgba[4 * i + c]);
    lum[i] = 0.2126 * cur[0][i] + 0.7152 * cur[1][i] + 0.0722 * cur[2][i];
  }
  const per = periods || brickPeriods(lum, w, h);
  if (!per.course || !per.brick || per.peak < P.MIN_PEAK) return null;
  const out = [{ data: new Uint8ClampedArray(rgba), width: w, height: h, joints: 0, courses: 0 }];
  const enc = (v) => (linear ? Math.round(255 * Math.min(1, Math.max(0, v))) : L2S[Math.round(4095 * Math.min(1, Math.max(0, v)))]);
  let cw = w, ch = h, s = 1;
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1); s *= 2;
    const nxt = [];
    for (let c = 0; c < 3; c++) {
      const src = cur[c], tmp = new Float32Array(nw * ch), dst = new Float32Array(nw * nh);
      for (let y = 0; y < ch; y++) for (let x = 0; x < nw; x++) {          // horizontal [1 3 3 1]/8 (or copy when not halving)
        if (nw === cw) { tmp[y * nw + x] = src[y * cw + x]; continue; }
        const a = 2 * x; tmp[y * nw + x] = (src[y * cw + (a - 1 + cw) % cw] + 3 * src[y * cw + a] + 3 * src[y * cw + (a + 1) % cw] + src[y * cw + (a + 2) % cw]) / 8;
      }
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {          // vertical
        if (nh === ch) { dst[y * nw + x] = tmp[y * nw + x]; continue; }
        const b = 2 * y; dst[y * nw + x] = (tmp[((b - 1 + ch) % ch) * nw + x] + 3 * tmp[b * nw + x] + 3 * tmp[((b + 1) % ch) * nw + x] + tmp[((b + 2) % ch) * nw + x]) / 8;
      }
      nxt.push(dst);
    }
    const joints = 1 - smooth(P.JOINT_FULL, P.JOINT_NONE, per.brick / s), courses = 1 - smooth(P.COURSE_FULL, P.COURSE_NONE, per.course / s);
    for (let c = 0; c < 3; c++) {
      if (joints > 0) blend(nxt[c], boxAlong(nxt[c], nw, nh, per.brick / s, true), joints);
      if (courses > 0) blend(nxt[c], boxAlong(nxt[c], nw, nh, per.course / s, false), courses);
    }
    const data = new Uint8ClampedArray(nw * nh * 4);
    for (let i = 0; i < nw * nh; i++) { data[4 * i] = enc(nxt[0][i]); data[4 * i + 1] = enc(nxt[1][i]); data[4 * i + 2] = enc(nxt[2][i]); data[4 * i + 3] = 255; }
    out.push({ data, width: nw, height: nh, joints, courses });
    cur = nxt; cw = nw; ch = nh;
  }
  out.periods = per;
  return out;
}
