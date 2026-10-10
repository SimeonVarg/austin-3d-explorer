/**
 * moire-mean.mjs — THE MOIRE FIX's means are the true means, and a wall drawn from them has the brightness of the wall drawn cell by cell.
 *
 * NO BROWSER, NO GPU, no three.js: Node and the repo's own js/slopes.js. A few seconds. Runs in CI.
 *
 * The fix (js/moire.js) draws a window too small for a pixel as the MEAN of its row and of its face. A wrong mean is worse than
 * none: every far wall would shift in brightness against the same wall up close. Three things are held here, on synthetic wall faces
 * (punched windows, ribbon windows, framed windows, a coloured-panel wall, lit and unlit panes, a mullion laid over a pane):
 *
 *  1. THE RECORD. What faceOpen / faceCell / faceClose write for a face equals the area-weighted means worked out a second way
 *     (the face rasterised at 1 cm, every sample classified on its own): opaque day / golden / night, glass day / golden,
 *     unlit and lit glass night, the glass share, the lit share. Tolerance 0.02 of a level (the raster's own resolution).
 *  2. THE ROW STRIP. Every strip texel equals that raster's mean over the texel's height: colour x opaque share and glass share
 *     within 0.75 of a level (bytes), lit share the same.
 *  3. THE PICTURE. A JS transcription of VERT's lighting and FRAG's shading (sun, shade, glass reflection, night ambient, window
 *     emission) is run on every CELL and averaged by area (what a supersampled picture of a far wall averages to, in the 8-bit
 *     space the frame buffer holds), and on the fix's three CLASS means with the fix's weights. Over 400 seeded lightings
 *     (day to night, sun in front and behind, shadow in and out) the two differ by at most 1.0 level in any channel BY DAY,
 *     which is "the far mean matches the near mean within 1 level" in the maths. From dusk on it is not exact (VERT's lighting
 *     brightens dark tones, which is not linear in the tone); the check prints the worst case and holds it under 8 levels.
 *     scripts/verify/moire-bar.mjs measures the same thing on the real page (its `bias` column).
 *
 *  4. THE EDGE STRIPS, read the way FRAG reads them (the wall's own direction as the axis, the height its foot is drawn at):
 *     every pane's centre is glass, a wall point clear of the panes is not, and a pixel-sized box reads the raster's glass share.
 *
 *   node scripts/verify/moire-mean.mjs            exit 0 = all four hold
 *   node scripts/verify/moire-mean.mjs --break    the glass share of every record is scaled by 1.15 after the build: must FAIL (exit 1)
 */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RM = path.join(REPO, 'experiments/rust-mesh');
const BREAK = process.argv.includes('--break');
const { installStubs } = await import(pathToFileURL(path.join(RM, 'profile/app-patch.mjs')));
const { THREE_STUB } = await import(pathToFileURL(path.join(RM, 'js/builder-app.mjs')));
{
  const ctx = globalThis;
  ctx.window = ctx; ctx.self = ctx; ctx.location = { search: '?slopes=0&packverts=1&moirefix=1', href: 'http://x/' };
  ctx.document = { getElementById: () => null, hidden: false, readyState: 'complete', createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, body: {} };
  ctx.addEventListener = () => {}; ctx.devicePixelRatio = 1; ctx.LITE_PROFILE = undefined;
  if (!ctx.navigator) Object.defineProperty(ctx, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  installStubs(ctx); ctx.THREE = THREE_STUB;
  // js/moire.js first: js/slopes.js reads window.MoireFix when it loads (in the page, js/city-lighting.js loads it between the two)
  for (const f of ['moire.js', 'slopes.js']) vm.runInThisContext(fs.readFileSync(path.join(REPO, 'js', f), 'utf8'), { filename: path.join(REPO, 'js', f) });
}
const S = globalThis.slopes, MOIRE = globalThis.MoireFix.params;
let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
say(typeof globalThis.MoireFix.tables === 'function' && !!MOIRE.px, 'js/moire.js loaded and hooked into js/slopes.js');

// ---- a seeded generator, and tones the way the app makes them --------------------------------------------------
let seed = 20261010;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const ramp = c => [hex(c), hex(c.map((v, i) => v + ([255, 190, 130][i] - v) * 0.16)), hex(c.map((v, i) => v * 0.19 + ([18, 22, 40][i] - v * 0.19) * 0.42))];   // js/slopes-apartments.js ramp()
const GLASS = [4, 1, 1, 0.8], BRICK = [2, 0.2, 0.07, 0.6];
const tone = (c, surface) => { const t = ramp(c); if (surface) t.surface = surface; return t; };
const LIT = ['#eed8b4', '#e5ddc9', '#cbdde2', '#f7e8cd'].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));   // js/city-night.js tune.tones
const litPane = pane => { const base = LIT[Math.floor(rnd() * 4)], gain = 0.62 + 0.38 * rnd(); const t = [pane[0], pane[1], hex(base.map(v => v * gain))]; t.surface = pane.surface; return t; };
const unlitPane = pane => { const t = [pane[0], pane[1], '#101823']; t.surface = pane.surface; return t; };
const b3 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// ---- synthetic faces: a list of rectangles [s0, s1, z0, z1, tone, glass, lit, fw, fh, reveal], later ones laid over earlier ones --------
function grid({ len, z0, floors, floorH, bay, win, sill, frame, wallC, glassC, frameC, litShare, mullion, panels }) {
  const wall = tone(wallC, BRICK), pane = tone(glassC, GLASS), fr = frameC ? tone(frameC) : null, z1 = z0 + floors * floorH;
  const rects = [[0, len, z0, z1, wall, false, false, 0, 0, 0]];
  if (panels) { for (let f = 0; f < floors; f++) for (let b = 0; b * bay < len; b++) if ((b - f) % 4 === 0 || rnd() < 0.2) rects.push([b * bay, Math.min(len, (b + 1) * bay), z0 + f * floorH, z0 + (f + 1) * floorH, panels[(b + f) % panels.length], false, false, 0, 0, 0]); return { len, z0, z1, rects }; }
  for (let f = 0; f < floors; f++) for (let b = 0; (b + 1) * bay <= len + 1e-9; b++) {
    const s0 = b * bay + (bay - win[0]) / 2, s1 = s0 + win[0], za = z0 + f * floorH + sill, zb = za + win[1];
    if (fr) rects.push([s0 - frame, s1 + frame, za - frame, zb + frame, fr, false, false, 0, 0, 0]);
    const lit = rnd() < litShare, t = lit ? litPane(pane) : unlitPane(pane);
    rects.push([s0, s1, za, zb, t, true, lit, win[0], win[1], 0.12]);
    if (mullion) rects.push([(s0 + s1) / 2 - 0.03, (s0 + s1) / 2 + 0.03, za, zb, fr || wall, false, false, 0, 0, 0, { over: t, lit }]);
  }
  return { len, z0, z1, rects };
}
const FACES = [
  grid({ len: 24, z0: 3, floors: 12, floorH: 3.05, bay: 3, win: [1.5, 1.6], sill: 0.9, wallC: [150, 82, 60], glassC: [42, 58, 74], litShare: 0.4 }),
  grid({ len: 31.5, z0: 0, floors: 20, floorH: 3.2, bay: 1.5, win: [1.38, 2.4], sill: 0.5, wallC: [205, 200, 190], glassC: [60, 86, 110], litShare: 0.25 }),          // ribbon: thin piers
  grid({ len: 18, z0: 6.5, floors: 7, floorH: 3.35, bay: 2.25, win: [0.73, 1.76], sill: 0.8, frame: 0.3, frameC: [236, 232, 224], wallC: [70, 66, 64], glassC: [34, 40, 48], litShare: 0.5 }),   // white frames on a dark wall
  grid({ len: 20, z0: 0, floors: 9, floorH: 3, bay: 2.5, win: [1.6, 1.9], sill: 0.7, frame: 0.08, frameC: [40, 40, 44], wallC: [222, 214, 196], glassC: [52, 70, 86], litShare: 0.6, mullion: true }),
  grid({ len: 26, z0: 4, floors: 10, floorH: 0.556 * 5, bay: 2.2, wallC: [188, 180, 168], glassC: [0, 0, 0], panels: [tone([92, 60, 48]), tone([226, 222, 214]), tone([150, 120, 96])] }),      // a coloured-panel wall, no glass
  grid({ len: 9.7, z0: 1.3, floors: 3, floorH: 4.1, bay: 3.2, win: [2.9, 3.3], sill: 0.4, wallC: [120, 126, 130], glassC: [70, 100, 120], litShare: 1 }),                // all lit, nearly all glass
];

// ---- the raster: every 1 cm sample classified on its own (the second way) -------------------------------------
const STEP = 0.01;
function raster(F) {
  const nx = Math.round(F.len / STEP), nz = Math.round((F.z1 - F.z0) / STEP), idx = new Int16Array(nx * nz);   // which rect owns the sample
  F.rects.forEach((r, i) => { const x0 = Math.max(0, Math.round(r[0] / STEP)), x1 = Math.min(nx, Math.round(r[1] / STEP)), y0 = Math.max(0, Math.round((r[2] - F.z0) / STEP)), y1 = Math.min(nz, Math.round((r[3] - F.z0) / STEP));
    for (let y = y0; y < y1; y++) idx.fill(i, y * nx + x0, y * nx + x1); });
  return { nx, nz, idx };
}
/** area by rect, and the same per horizontal line */
function areas(F, R) { const a = new Float64Array(F.rects.length); for (let i = 0; i < R.idx.length; i++) a[R.idx[i]]++; return a; }

const FRAME = { o: [-660.4, 111.7], t: [0.6, 0.8], lift: 2.5, out: [0.8 * Math.cos(0.001) + 0.6 * Math.sin(0.001), -0.6 * Math.cos(0.001) + 0.8 * Math.sin(0.001), 0] };
// ---- drive the real recorder the way js/slopes-apartments.js's cell tiler does: disjoint cells, then the parts laid over panes ------------
function record(T, F) {
  // The wall stands 700 m from the origin, its foot is drawn 2.5 m above its own z0, and the frame's `outward` is a twentieth of a degree off
  // square: the three things that put the first edge strips most of a metre off on the real page.
  const R = raster(F), id = T.faceOpen(F.z0, F.z1, F.len, [FRAME.o[0], FRAME.o[1], F.z0 + FRAME.lift], [FRAME.t[0], FRAME.t[1], 0], FRAME.out);
  // cells: maximal runs of one owner along each 1 cm line would be 100x more calls than the tiler makes; cut the face on every rect edge instead
  const xs = [...new Set(F.rects.flatMap(r => [Math.max(0, r[0]), Math.min(F.len, r[1])]))].sort((a, b) => a - b), zs = [...new Set(F.rects.flatMap(r => [r[2], r[3]]))].sort((a, b) => a - b);
  for (let j = 0; j + 1 < zs.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
    const sm = (xs[i] + xs[i + 1]) / 2, zm = (zs[j] + zs[j + 1]) / 2;
    let own = null; for (const r of F.rects) if (!r[10] && sm > r[0] && sm < r[1] && zm > r[2] && zm < r[3]) own = r;   // the last one laid there
    if (!own) continue;
    T.faceCell(xs[i], xs[i + 1], zs[j], zs[j + 1], own[4], own[5], own[6], own[7], own[8], own[9]);
  }
  for (const r of F.rects) if (r[10]) { T.faceCell(r[0], r[1], r[2], r[3], r[4], false, false, 0, 0, 0); T.faceCell(r[0], r[1], r[2], r[3], r[10].over, true, r[10].lit, 0, 0, 0, true); }
  T.faceClose();
  return { id, R };
}

// ---- 3: the shading, transcribed (js/slopes.js VERT + FRAG's SHADE_CORE, js/city-lighting.js cityShadeLit / cityEmission) --------------
const luma = c => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, mixv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), clamp01 = x => Math.max(0, Math.min(1, x));
const lin = c => c.map(v => Math.pow(Math.max(v, 0), 2.2)), disp = c => c.map(v => Math.pow(Math.max(v, 0), 1 / 2.2));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function lit(day, gold, dark, U) {
  let color = U.P <= 0.5 ? mixv(day, gold, U.P * 2) : mixv(gold, dark, (U.P - 0.5) * 2);
  const cv = luma(color); color = color.map(v => v + 0.03);
  let d = clamp01(U.ndl); d = (1 - U.I) + (Math.max(1 - cv + U.I, 1) - (1 - U.I)) * d;
  return color.map((v, i) => Math.max(0.3 * (1 - U.lc[i]), Math.min(1, v * d * U.lc[i])));
}
function shade(day, gold, dark, surface, U) {
  let col = lit(day, gold, dark, U);
  const kind = surface ? surface[0] : 0, shop = kind > 5.5 && kind < 6.5, glazing = ((kind > 3.5 && kind < 4.5) || shop) ? 1 : 0;
  const glass = glazing * (shop ? 1 : clamp01(surface ? surface[3] : 0));
  if (U.sun && U.presence > 0) {
    let diffuse = lin(day).map((v, i) => v * (U.shadeLin[i] * (U.amb + U.fill) + U.sunLin[i] * U.facing * U.vis * U.direct));
    if (glass > 0) { const refl = clamp01((U.base + (1 - U.base) * U.fresnel) * glass * U.glassStrength); diffuse = mixv(diffuse, U.env, refl); }
    col = mixv(col, disp(diffuse), U.presence);
  }
  const opaqueWall = (kind < 3.5 || kind > 6.5) ? 1 : 0;
  col = mixv(col, col.map((v, i) => Math.max(v, day[i] * U.wallAmbient)), U.night * opaqueWall);
  const mask = ((kind > 3.5 && kind < 5.5) || shop) ? 1 : 0;
  if (U.night > 0 && mask > 0) { const l = smooth(U.thr[0], U.thr[1], luma(dark)); col = mixv(col, col.map((v, i) => Math.max(v, dark[i] * U.gain)), U.night * mask * l); }
  if (kind > 0.5 && glazing > 0.5 && !U.sun) col = mixv(col, U.sky, U.reflect * (U.reflectFloor + (1 - U.reflectFloor) * U.fresnel3) * surface[3] * U.daylight);
  return col;
}
function lighting() {
  const p = rnd(), night = p > 0.56 ? smooth(0.56, 0.9, p) : 0, sunUp = p < 0.6;
  const U = { P: p <= 0.56 ? p : 0.56 + 0.44 * night, ndl: rnd() * 1.6 - 0.4, I: 0.25 + 0.3 * rnd(), lc: night > 0.5 ? [0.25 + 0.2 * rnd(), 0.3 + 0.2 * rnd(), 0.45 + 0.2 * rnd()] : [0.9 + 0.1 * rnd(), 0.85 + 0.15 * rnd(), 0.75 + 0.25 * rnd()],
    sun: true, presence: Math.max(0, Math.min(1, (0.56 - p) / 0.1)), shadeLin: lin([0.5 + 0.3 * rnd(), 0.55 + 0.3 * rnd(), 0.7 + 0.3 * rnd()]), sunLin: lin([1, 0.9 + 0.1 * rnd(), 0.75 + 0.2 * rnd()]),
    amb: 0.3 + 0.4 * rnd(), fill: 0.12, facing: Math.max(0, rnd() * 1.4 - 0.4), vis: rnd() < 0.3 ? 0 : rnd() < 0.5 ? 1 : rnd(), direct: 0.6 + 0.8 * rnd(),
    base: 0.1 + 0.3 * rnd(), fresnel: Math.pow(rnd(), 3), glassStrength: 0.6 + 0.4 * rnd(), env: lin([0.4 + 0.5 * rnd(), 0.5 + 0.4 * rnd(), 0.6 + 0.4 * rnd()]),
    night, wallAmbient: 0.22, thr: [0.26, 0.48], gain: 1.12, sky: [0.5 + 0.4 * rnd(), 0.6 + 0.3 * rnd(), 0.7 + 0.3 * rnd()], reflect: 0.3 + 0.3 * rnd(), reflectFloor: 0.3, fresnel3: Math.pow(rnd(), 2), daylight: 1 - smooth(0.5, 0.95, p) };
  return U;
}

// ---- run ---------------------------------------------------------------------------------------------------------
const T = S.packTables(); const MAXN = 2 ** (31 - 14);
say(!!(T && T.faceOpen), 'the packed tables carry the face recorder');
const recs = FACES.map(F => record(T, F));
const FT = MOIRE.FACE_TEXELS * 4, RW = MOIRE.ROW_W;
if (BREAK) for (const r of recs) T.faces[r.id * FT + 3] *= 1.15;
let worstRec = 0, worstRow = 0, worstPic = 0, worstDay = 0, where = '';
FACES.forEach((F, fi) => {
  const { id, R } = recs[fi], W = T.faces, o = id * FT, tex = k => [W[o + k * 4], W[o + k * 4 + 1], W[o + k * 4 + 2], W[o + k * 4 + 3]];
  // -- 1. the record against the raster --
  const A = areas(F, R), tot = R.idx.length;
  const sum = (sel, pick) => { let a = 0; const c = [0, 0, 0]; F.rects.forEach((r, i) => { if (!sel(r) || !A[i]) return; a += A[i]; const v = b3(pick(r)); for (let k = 0; k < 3; k++) c[k] += A[i] * v[k]; }); return { a, c: a ? c.map(v => v / a / 255) : [0, 0, 0] }; };
  const isG = r => r[5], isO = r => !r[5];
  const want = { oD: sum(isO, r => r[4][0]), oG: sum(isO, r => r[4][1]), oN: sum(isO, r => r[4][2]), gD: sum(isG, r => r[4][0]), gG: sum(isG, r => r[4][1]), uN: sum(r => r[5] && !r[6], r => r[4][2]), lN: sum(r => r[5] && r[6], r => r[4][2]) };
  const got = { oD: tex(0), oG: tex(1), oN: tex(2), gD: tex(3), gG: tex(4), uN: tex(5), lN: tex(6) };
  for (const k in want) for (let c = 0; c < 3; c++) worstRec = Math.max(worstRec, Math.abs(want[k].c[c] - got[k][c]) * 255);
  const g = want.gD.a / tot, L = want.lN.a / tot;
  worstRec = Math.max(worstRec, Math.abs(g - tex(0)[3]) * 255, Math.abs(L - tex(1)[3]) * 255);
  // -- 2. the strip against the raster --
  const r8 = tex(8), n = tex(9)[0], base = (r8[1] * RW + r8[0]) * 4, perTexel = (F.z1 - F.z0) / n / STEP;
  for (let k = 0; k < n; k++) {
    const u0 = k * perTexel, u1 = (k + 1) * perTexel;                 // the texel's height in raster lines; a line it only partly covers counts for that part
    let cnt = 0, gl = 0, li = 0; const od = [0, 0, 0], on = [0, 0, 0];
    for (let y = Math.floor(u0); y < Math.min(R.nz, Math.ceil(u1)); y++) { const wt = Math.min(u1, y + 1) - Math.max(u0, y); if (wt <= 0) continue;
      for (let x = 0; x < R.nx; x++) { const r = F.rects[R.idx[y * R.nx + x]]; cnt += wt; if (r[5]) { gl += wt; if (r[6]) li += wt; } else { const d = b3(r[4][0]), nn = b3(r[4][2]); for (let c = 0; c < 3; c++) { od[c] += wt * d[c]; on[c] += wt * nn[c]; } } } }
    for (let c = 0; c < 3; c++) worstRow = Math.max(worstRow, Math.abs(od[c] / cnt - T.rowA[base + k * 4 + c]), Math.abs(on[c] / cnt - T.rowB[base + k * 4 + c]));
    worstRow = Math.max(worstRow, Math.abs(255 * gl / cnt - T.rowA[base + k * 4 + 3]), Math.abs(255 * li / cnt - T.rowB[base + k * 4 + 3]));
  }
  // -- 3. the picture: every cell shaded and averaged, against the fix's class shades of the record --
  const f01 = h => b3(h).map(v => v / 255);
  for (let t = 0; t < 400; t++) {
    const U = lighting(), truth = [0, 0, 0];
    F.rects.forEach((r, i) => { if (!A[i]) return; const c = shade(f01(r[4][0]), f01(r[4][1]), f01(r[4][2]), r[4].surface, U); for (let k = 0; k < 3; k++) truth[k] += c[k] * A[i] / tot; });
    const gS = tex(0)[3], LS = tex(1)[3], glassS = [4, 0, 0, tex(6)[3]];
    let wo = 1 - gS, wl = Math.min(LS, gS), wu = Math.max(gS - LS, 0);
    if (U.night <= 0 && U.P <= 0.5) { wu += wl; wl = 0; }
    const far = [0, 0, 0], add = (w, c) => { for (let k = 0; k < 3; k++) far[k] += w * c[k]; };
    if (wo > 0) add(wo, shade(got.oD, got.oG, got.oN, tex(7), U));
    if (wu > 0) add(wu, shade(got.gD, got.gG, got.uN, glassS, U));
    if (wl > 0) add(wl, shade(got.gD, got.gG, got.lN, glassS, U));
    for (let k = 0; k < 3; k++) { const d = Math.abs(far[k] - truth[k]) * 255; if (U.presence >= 1) worstDay = Math.max(worstDay, d); else if (d > worstPic) { worstPic = d; where = `face ${fi}, lighting ${t} (P ${U.P.toFixed(2)}, night ${U.night.toFixed(2)}, sun presence ${U.presence.toFixed(2)})`; } }
  }
});
// -- 4. the edge strips, read the way FRAG reads them: glass share of a pixel footprint = share up the wall x share along it, from the running sums --
{
  const fine = T.fine, W = T.faces;
  const sum = (base, u) => { const k = Math.floor(u); return fine[base + k] + (fine[base + k + 1] - fine[base + k]) * (u - k); };
  const share = (base, n, c, span) => { const u0 = Math.max(0, Math.min(n - 1e-4, c - span)), u1 = Math.max(0, Math.min(n - 1e-4, c + span)); return (sum(base, u1) - sum(base, u0)) / (2 * span); };
  // FRAG's axis: the cell's own normal (exactly square to the wall, on the side `outward` points) turned a quarter
  const nrm = (FRAME.out[0] * FRAME.t[1] - FRAME.out[1] * FRAME.t[0]) > 0 ? [FRAME.t[1], -FRAME.t[0]] : [-FRAME.t[1], FRAME.t[0]], ax = [-nrm[1], nrm[0]];
  let worstPane = 1, worstWall = 0, worstBox = 0, panes = 0;
  FACES.forEach((F, fi) => {
    const o = recs[fi].id * FT, r8z = W[o + 34], base = W[o + 37], nz = W[o + 38], ns = W[o + 39], invZ = W[o + 40], invS = W[o + 41], s0 = W[o + 42];
    if (!(nz > 0)) return;                              // a face with no glass has no strips
    const R = recs[fi].R;
    const cover = (sc, zc, fs, fz) => { const p = [FRAME.o[0] + sc * FRAME.t[0], FRAME.o[1] + sc * FRAME.t[1]], axis = p[0] * ax[0] + p[1] * ax[1], zDrawn = zc + FRAME.lift;
      return Math.max(0, Math.min(1, share(base, nz, (zDrawn - r8z) * invZ, Math.max(0.5, 0.5 * fz * invZ)) * share(base + nz + 1, ns, (axis - s0) * invS, Math.max(0.5, 0.5 * fs * Math.abs(invS))))); };
    for (const r of F.rects) {
      if (r[10] || r[1] - r[0] < 0.5 || r[3] - r[2] < 0.5) continue;
      const sc = (r[0] + r[1]) / 2, zc = (r[2] + r[3]) / 2, own = F.rects[R.idx[Math.round((zc - F.z0) / STEP) * R.nx + Math.round(sc / STEP)]];
      if (own !== r) continue;                          // something is laid over its centre
      if (r[5]) { panes++; worstPane = Math.min(worstPane, cover(sc, zc, 0.01, 0.01)); }
    }
    // a wall point two strip texels clear of every pane reads no glass; and a box of 0.3 to 1.5 m reads the raster's own glass share (grids only)
    for (let t = 0; t < 300; t++) {
      const fs = 0.3 + 1.2 * rnd(), fz = 0.3 + 1.2 * rnd(), sc = fs / 2 + rnd() * (F.len - fs), zc = F.z0 + fz / 2 + rnd() * (F.z1 - F.z0 - fz);
      let g = 0, n = 0; for (let y = Math.round((zc - fz / 2 - F.z0) / STEP); y < Math.round((zc + fz / 2 - F.z0) / STEP); y++) for (let x = Math.round((sc - fs / 2) / STEP); x < Math.round((sc + fs / 2) / STEP); x++) { n++; if (F.rects[R.idx[y * R.nx + x]][5] || (F.rects[R.idx[y * R.nx + x]][10] && true)) g++; }
      const c = cover(sc, zc, fs, fz);
      if (n) worstBox = Math.max(worstBox, Math.abs(c - g / n));
      if (g === 0 && n) { let clear = true; for (const r of F.rects) if (r[5] && sc + fs / 2 + 0.2 > r[0] && sc - fs / 2 - 0.2 < r[1] && zc + fz / 2 + 0.2 > r[2] && zc - fz / 2 - 0.2 < r[3]) clear = false; if (clear && c > 0) { let inRow = false, inCol = false; for (const r of F.rects) if (r[5]) { if (zc + fz / 2 + 0.2 > r[2] && zc - fz / 2 - 0.2 < r[3]) inRow = true; if (sc + fs / 2 + 0.2 > r[0] && sc - fs / 2 - 0.2 < r[1]) inCol = true; } if (!(inRow && inCol)) worstWall = Math.max(worstWall, c); } }
    }
  });
  say(panes > 100 && worstPane >= 0.999, `4a. edge strips: the centre of every pane reads as glass (${panes} panes, lowest ${worstPane.toFixed(4)}), on a wall 700 m out with a frame a twentieth of a degree off square`);
  say(worstWall <= 0.001, `4b. edge strips: a wall point clear of every pane's row or column reads no glass (highest ${worstWall.toFixed(4)})`);
  say(worstBox <= 0.12, `4c. edge strips: the glass share of a 0.3 to 1.5 m box matches the 1 cm raster within ${worstBox.toFixed(3)} (limit 0.12: the strips' 0.1 m texel)`);
}
say(worstRec <= 0.02, `1. face records equal the rastered area means: worst difference ${worstRec.toFixed(4)} of a level (limit 0.02)`);
say(worstRow <= 0.75, `2. row strips equal the rastered row means: worst difference ${worstRow.toFixed(3)} of a level (limit 0.75)`);
say(worstDay <= 1.0, `3a. by day (the sun's own shading fully on) the far wall is as bright as the near wall: worst channel difference ${worstDay.toFixed(3)} of a level over ${FACES.length} faces (limit 1.0)`);
// Dusk and night are NOT exact, and this line says by how much: VERT brightens a dark tone (max(1 - luma + intensity, 1)), which is not linear in the
// tone, and from dusk on that vertex colour shows. A wall of dark and pale parts side by side is the worst case. The limit holds the size of it.
say(worstPic <= 8.0, `3b. dusk and night: worst channel difference ${worstPic.toFixed(3)} of a level (limit 8.0; not exact, see the comment) at ${where}`);
// a face of one tone takes no record; the fix off takes no face at all
{ const T2 = S.packTables(); const id = T2.faceOpen(0, 10); T2.faceCell(0, 5, 0, 10, tone([100, 100, 100]), false, false, 0, 0, 0); T2.faceClose();
  say(id === 1 && T2.faces[id * FT + 11] === 0, 'a face of one tone stays inactive (feature size 0: FRAG leaves it alone)');
  T2.nNormals = MAXN; say(T2.faceOpen(0, 10) === 0, 'with the normal table nearly full no face number is handed out (no overflow)'); }
// the normal table: a face number separates two entries of one direction, and no face is the entry it always was
{ const T3 = S.packTables(); const a = T3.normal(1, 0, 0), b = T3.normal(1, 0, 0, 7), c = T3.normal(1, 0, 0, 7), d = T3.normal(1, 0, 0);
  say(a === 0 && b === 1 && c === 1 && d === 0 && T3.normals[3] === 0 && T3.normals[7] === 7, 'a wall face rides in the normal table\'s fourth float; a normal without one keeps its entry'); }
// the shader patch finds its anchors in js/slopes.js's fragment shader text (a rewrite of that shader that moves them turns the fix off in the page)
{ const src = fs.readFileSync(path.join(REPO, 'js/slopes.js'), 'utf8'), a = src.indexOf('const FRAG0 = `') + 'const FRAG0 = `'.length, b = src.indexOf('`;', a);
  const decoy = 'vec3 col=baseColor.rgb; float fresnel=pow(1.0-clamp(x,0.0,1.0),5.0); void main() {} if(kind>.5 && u_surfaceRange.x>.5) {}\n';   // the city-lighting text above main() has lines like these
  const frag = decoy + new Function('window', 'return `' + src.slice(a, b) + '`')(globalThis);
  const out = globalThis.MoireFix.patch(frag), open = (out.match(/{/g) || []).length, close = (out.match(/}/g) || []).length;
  say(out !== frag && out.includes('col=moireBlend(col,glazing);') && out.includes('vec3 moireFar(') && out.indexOf('vec3 moireFar(') < out.lastIndexOf('void main() {') && open === close, `the shader patch finds its anchors in FRAG (${frag.length} -> ${out.length} characters, braces ${open}/${close})`); }
console.log(failed ? `\nFAIL: ${failed} check(s)` : '\nPASS: the means are the true means, and the far wall is as bright as the near wall');
process.exit(failed ? 1 : 0);
