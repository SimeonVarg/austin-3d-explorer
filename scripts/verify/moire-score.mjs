/**
 * moire-score.mjs - the pure part of moire-meter.mjs (no browser, no side effects on import).
 *
 * statOver and settleWith run INSIDE the page (moire-meter.mjs injects their source), so each must be
 * self-contained: no reference to anything outside its own body. tableLines and verdict run in Node.
 * Split out so moire-score-check.mjs can feed them small synthetic inputs.
 */

// Error / band / flicker over the pixels sel(p) selects. ctx = { e, N, W, frames }: e[f] is the signed
// 1x - truth error of frame f (Float32Array N*3, RGB), W the image width, N the pixel count.
export function statOver(sel, ctx) {
  const { e, N, W, frames } = ctx;
  const pctl = (arr, q) => { if (!arr.length) return 0; const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
  const errAll = [], flick = [];
  let sErr = 0, sBand = 0, sFl = 0, n = 0;
  for (let p = 0; p < N; p++) {
    if (!sel(p) || (p % W) < 1 || (p % W) > W - 2 || p < W || p >= N - W) continue;
    n++;
    let fm = 0, fm2 = 0;
    for (let f = 0; f < frames; f++) {
      const E = e[f], o = p * 3;
      const err = (Math.abs(E[o]) + Math.abs(E[o + 1]) + Math.abs(E[o + 2])) / 3;
      sErr += err; if (f === 0 || f === frames >> 1 || f === frames - 1) errAll.push(err);
      // band: 3x3 box of the signed error (blur(1x) - blur(truth) = blur(1x - truth))
      let bs0 = 0, bs1 = 0, bs2 = 0;
      for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) { const oo = (p + j * W + q) * 3; bs0 += E[oo]; bs1 += E[oo + 1]; bs2 += E[oo + 2]; }
      const band = (Math.abs(bs0) + Math.abs(bs1) + Math.abs(bs2)) / 27; sBand += band;
      const l = (E[o] + E[o + 1] + E[o + 2]) / 3; fm += l; fm2 += l * l;
    }
    const mean = fm / frames, sd = Math.sqrt(Math.max(0, fm2 / frames - mean * mean));
    sFl += sd; flick.push(sd);
  }
  // No pixels: nothing was measured, which is not the same as zero error. One frame: flicker is a spread over
  // frames, so it is not measured either. null says so; the table and the verdict refuse to treat it as a pass.
  if (!n) return { n, err: null, p99: null, band: null, flick: null, flickP99: null };
  const fl = frames >= 2;
  return { n, err: sErr / (n * frames), p99: pctl(errAll, 0.99), band: sBand / (n * frames), flick: fl ? sFl / n : null, flickP99: fl ? pctl(flick, 0.99) : null };
}

// Wait until the page is quiet and the map is idle, twice. env = { quiet(), sleep(ms), now(), waitIdle(ms),
// quietMaxMs, idleMaxMs }; waitIdle repaints and resolves true on 'idle', false on its timeout.
// A timeout THROWS: carrying on would score a half-built city or a frame that was never drawn.
export async function settleWith(env) {
  for (let k = 0; k < 2; k++) {
    const t = env.now();
    while (!env.quiet() && env.now() - t < env.quietMaxMs) await env.sleep(200);
    if (!env.quiet()) throw new Error(`settle: the page was still busy (walls being stamped or buildings being built) after ${env.quietMaxMs / 1000} s; not scoring a half-built city`);
    if (!(await env.waitIdle(env.idleMaxMs))) throw new Error(`settle: the map did not go idle within ${env.idleMaxMs / 1000} s; not scoring a frame that may not have been drawn`);
    await env.sleep(150);
  }
}

const num = x => typeof x === 'number' && Number.isFinite(x);
export const f2 = x => num(x) ? x.toFixed(2) : '--';
export const atFloor = (x, fl, P) => num(x) && num(fl) && x <= fl * P.FLOOR_SLACK + P.FLOOR_ABS;

// The table, one string per line. P = { FLOOR_SLACK, FLOOR_ABS }. A view that measured nothing prints '--' and
// 'n/a' where a pass would go, and stays out of the mean; a floor that measured nothing is 'n/a', not a pass.
export function tableLines(rows, P) {
  const pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);
  const out = [];
  out.push(pad('view', 22) + lp('bldg%', 6) + lp('aptShare', 9) + lp('err', 7) + lp('p99', 7) + lp('band', 7) + lp('flick', 7) + lp('flkP99', 7) + ' |' + lp('aptErr', 7) + lp('mplErr', 7) + ' |' + lp('flrErr', 7) + lp('flrP99', 7) + lp('flrFlk', 7) + lp('flat%', 6) + '  at-floor(err/p99/flk)');
  for (const r of rows) {
    const a = r.all, fl = r.floor, empty = !(a.n > 0);
    const ok = empty ? 'n/a (EMPTY: no building pixels)' : [['err', 'err'], ['p99', 'p99'], ['flick', 'flick']].map(([k]) => num(a[k]) && num(fl[k]) ? (atFloor(a[k], fl[k], P) ? 'Y' : 'n') : '?').join('/');
    out.push(pad(r.name, 22) + lp((r.mask * 100).toFixed(1), 6) + lp(empty ? '--' : (r.authored / Math.max(r.mask, 1e-9) * 100).toFixed(0) + '%', 9) + lp(f2(a.err), 7) + lp(f2(a.p99), 7) + lp(f2(a.band), 7) + lp(f2(a.flick), 7) + lp(f2(a.flickP99), 7) + ' |' + lp(f2(r.apt.err), 7) + lp(f2(r.mpl.err), 7) + ' |' + lp(f2(fl.err), 7) + lp(f2(fl.p99), 7) + lp(f2(fl.flick), 7) + lp((r.flatShare * 100).toFixed(0), 6) + '  ' + ok);
  }
  for (const name of [...new Set(rows.map(r => r.arm))]) {
    const rs = rows.filter(r => r.arm === name), used = rs.filter(r => r.all.n > 0);
    const avg = k => { const v = used.map(r => r.all[k]).filter(num); return v.length === used.length && v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    out.push(pad('MEAN ' + name, 22) + lp('', 6) + lp('', 9) + lp(f2(avg('err')), 7) + lp(f2(avg('p99')), 7) + lp(f2(avg('band')), 7) + lp(f2(avg('flick')), 7) + lp(f2(avg('flickP99')), 7) + `   (${used.length} of ${rs.length} views counted)`);
  }
  return out;
}

// What makes a run untrustworthy. Returns a list of strings; empty = fine. The meter exits 1 on any.
// P = { FLOOR_SLACK, FLOOR_ABS, FRAMES }.
export function verdict(rows, P) {
  const f = [];
  if (!rows.length) f.push('no view was scored');
  if (P && P.FRAMES != null && !(P.FRAMES >= 2)) f.push(`--frames ${P.FRAMES}: flicker needs at least 2 frames`);
  for (const r of rows) {
    const a = r.all;
    if (!(a.n > 0)) { f.push(`${r.name}: no building pixels in the mask (the camera sees no building, or hiding the building layers changed nothing); its numbers are not measurements and it is left out of the mean`); continue; }
    for (const k of ['err', 'p99', 'band']) if (!num(a[k])) f.push(`${r.name}: ${k} is not a number`);
    if (!num(a.flick)) f.push(`${r.name}: flicker was not measured (it needs at least 2 frames)`);
  }
  return f;
}
