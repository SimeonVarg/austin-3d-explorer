// A recorded-stream-shaped set of builder calls the apartment generator never makes but the shared builder serves to other generators:
// triN, facet runs, bent quads, degenerate triangles, wound-the-wrong-way quads. Deterministic. No in-app sha exists for these, so the app's own
// build() is the reference. Used by compare.mjs and scripts/verify/packverts-decode.mjs.
// ── part 2: the calls the apartment generator never makes but the shared builder serves to other generators
// (triN, facet runs, bent quads, degenerate triangles, wound-the-wrong-way quads). No in-app sha exists for
// these, so the app's own build() is the reference.
export function synthetic() {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const recs = []; const R = (op, col, want, a, b, c, d, na, nb, nc, flag) => { const r = new Float64Array(28); r[0] = op; r[1] = col; if (want) { r[2] = 1; r.set(want, 3); } for (const [o, v] of [[6, a], [9, b], [12, c], [15, d], [18, na], [21, nb], [24, nc]]) if (v) r.set(v, o); if (flag) r[27] = 1; recs.push(r); };
  for (let i = 0; i < 6000; i++) {
    const x = rnd() * 100, y = rnd() * 100, z = rnd() * 30, col = i % 5, k = rnd(), want = rnd() < 0.5 ? [0, 0, rnd() < 0.5 ? 1 : -1] : null;
    if (i % 97 === 0) R(3, 0, null, null, null, null, null, null, null, null, rnd() < 0.5);
    if (k < 0.35) R(1, col, want, [x, y, z], [x + 2, y, z], [x + 2, y + 3, z], [x, y + 3, z]);
    else if (k < 0.5) R(1, col, want, [x, y, z], [x + 2, y, z], [x + 2, y + 3, z + 0.5], [x, y + 3, z]);          // bent: takes the two-triangle path
    else if (k < 0.6) R(1, col, want, [x, y, z], [x + 2, y, z], [x + 2, y, z], [x, y + 3, z]);                       // degenerate half
    else if (k < 0.75) R(0, col, want, [x, y, z], [x + 1, y, z + 1], [x, y + 2, z]);
    else if (k < 0.8) R(0, col, want, [x, y, z], [x + 1, y, z], [x + 2, y, z]);                                      // collinear: dropped
    else R(2, col, null, [x, y, z], [x + 1, y, z], [x, y + 1, z + 1], null, [0, 0, 1], [0.6, 0, 0.8], [0, 0.6, 0.8]);
  }
  const s = new Float64Array(recs.length * 28); recs.forEach((r, i) => s.set(r, i * 28));
  const pal = [0, 1, 2, 3, 4].map(i => ({ hex: ['#' + (0x123456 + i * 0x0a1b2c).toString(16).padStart(6, '0'), '#abcdef', '#102030'], surface: i % 2 ? [4, 0.25 + i / 10, 0.5, 0.75] : null }));
  return { stream: s, records: recs.length, palette: pal };
}
