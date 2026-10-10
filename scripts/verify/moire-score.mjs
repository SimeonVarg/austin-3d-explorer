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
  return { n, err: n ? sErr / (n * frames) : 0, p99: pctl(errAll, 0.99), band: n ? sBand / (n * frames) : 0, flick: n ? sFl / n : 0, flickP99: pctl(flick, 0.99) };
}

// Wait until the page is quiet and the map is idle, twice. env = { quiet(), sleep(ms), now(), waitIdle(ms),
// quietMaxMs, idleMaxMs }; waitIdle repaints and resolves true on 'idle', false on its timeout.
export async function settleWith(env) {
  for (let k = 0; k < 2; k++) {
    const t = env.now();
    while (!env.quiet() && env.now() - t < env.quietMaxMs) await env.sleep(200);
    await env.waitIdle(env.idleMaxMs);
    await env.sleep(150);
  }
}

export const f2 = x => x.toFixed(2);
export const atFloor = (x, fl, P) => x <= fl * P.FLOOR_SLACK + P.FLOOR_ABS;

// The table, one string per line. P = { FLOOR_SLACK, FLOOR_ABS }.
export function tableLines(rows, P) {
  const pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);
  const out = [];
  out.push(pad('view', 22) + lp('bldg%', 6) + lp('aptShare', 9) + lp('err', 7) + lp('p99', 7) + lp('band', 7) + lp('flick', 7) + lp('flkP99', 7) + ' |' + lp('aptErr', 7) + lp('mplErr', 7) + ' |' + lp('flrErr', 7) + lp('flrP99', 7) + lp('flrFlk', 7) + lp('flat%', 6) + '  at-floor(err/p99/flk)');
  for (const r of rows) {
    const a = r.all, fl = r.floor;
    const ok = [atFloor(a.err, fl.err, P), atFloor(a.p99, fl.p99, P), atFloor(a.flick, fl.flick, P)].map(b => b ? 'Y' : 'n').join('/');
    out.push(pad(r.name, 22) + lp((r.mask * 100).toFixed(1), 6) + lp((r.authored / Math.max(r.mask, 1e-9) * 100).toFixed(0) + '%', 9) + lp(f2(a.err), 7) + lp(f2(a.p99), 7) + lp(f2(a.band), 7) + lp(f2(a.flick), 7) + lp(f2(a.flickP99), 7) + ' |' + lp(f2(r.apt.err), 7) + lp(f2(r.mpl.err), 7) + ' |' + lp(f2(fl.err), 7) + lp(f2(fl.p99), 7) + lp(f2(fl.flick), 7) + lp((r.flatShare * 100).toFixed(0), 6) + '  ' + ok);
  }
  for (const name of [...new Set(rows.map(r => r.arm))]) {
    const rs = rows.filter(r => r.arm === name);
    const avg = k => rs.reduce((s, r) => s + r.all[k], 0) / rs.length;
    out.push(pad('MEAN ' + name, 22) + lp('', 6) + lp('', 9) + lp(f2(avg('err')), 7) + lp(f2(avg('p99')), 7) + lp(f2(avg('band')), 7) + lp(f2(avg('flick')), 7) + lp(f2(avg('flickP99')), 7));
  }
  return out;
}

// What makes a run untrustworthy. Returns a list of strings; empty = fine.
export function verdict(rows, P) {
  return [];
}
