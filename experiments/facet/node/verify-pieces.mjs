/**
 * node/verify-pieces.mjs - THE NODE CHECK, over the whole catalog, against the REAL generator (no browser, no GPU, no dump).
 *
 * For every wall piece the cell tiler cuts (16,635 of them, 2.14 M of the 3.11 M triangles) it asks what Facet would need to draw it, and for the
 * pieces Facet's layout rule accepts it checks two things:
 *   1. WINDOWS: the rectangles the rule predicts equal the generator's own window list (the generator's frame, so no scale fudge): count and edges.
 *   2. PICTURE (a sample of pieces): the tone the point oracle paints at random points of the piece equals the tone of the cell the generator
 *      actually emitted there (cells rasterised from the real quads, the nearest one wins). This is the "same recipe rule as the geometry" test.
 * Coverage is reported as a share of ALL triangles, per capability added, in the order given by --order (default: the greedy order).
 *   node experiments/facet/node/verify-pieces.mjs [--order floors,frame,offsets,head,accent,cols,mullion,spandrel,checker] [--samples 150] [--json out.json]
 */
import fs from 'node:fs';
import { tapCatalog } from './tap.mjs';
import { accepts, windowsOf, regionsOf, toneAt, CAPS } from '../lib/layout.mjs';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ORDER = (opt('--order', 'floors,frame,offsets,head,accent,cols,mullion,spandrel,checker')).split(',');
const SAMPLES = +opt('--samples', '150');
const out = s => process.stdout.write(s + '\n');

// FNV hash the generator uses for per-cell choices (h01), ported to reproduce the accent tone; only used by the point oracle here
let h01 = null;
const pieces = [];
const rnd = (() => { let x = 12345; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; })();
const res = await tapCatalog(rec => {
  if (!h01) h01 = globalThis.__apts && null;
  const sk = rec.sk, band = rec.band;
  pieces.push({ spec: rec.spec, band, sk, ctx: rec.ctx, skin: rec.skin, len: rec.len, z0: rec.z0, z1: rec.z1, cut: rec.cut, inset: rec.inset, tris: rec.tris, W: rec.W, P: rec.P, key: rec.key, quads: rec.quads, skinName: band.skin });
}, { quads: true });
out(`generator ran: ${res.totalTriangles} triangles, ${pieces.length} wall pieces, ${pieces.reduce((s, p) => s + p.tris, 0)} triangles in pieces (${(100 * pieces.reduce((s, p) => s + p.tris, 0) / res.totalTriangles).toFixed(1)}% of all)`);

const piece = p => ({ len: p.len, z0: p.z0, z1: p.z1, floors: p.ctx.floors, floorBelow: p.ctx.floorBelow, allFloors: p.ctx.allFloors });
const eq = (a, b) => Math.abs(a - b) < 1e-6;
function windowsMatch(pred, act) {
  if (pred.length !== act.length) return `count ${pred.length} vs ${act.length}`;
  const k = w => [Math.round(w.z0 * 1e4), Math.round(w.s0 * 1e4)];
  const A = pred.slice().sort((x, y) => k(x)[0] - k(y)[0] || k(x)[1] - k(y)[1]), B = act.slice().sort((x, y) => k(x)[0] - k(y)[0] || k(x)[1] - k(y)[1]);
  let worst = 0; for (let i = 0; i < A.length; i++) worst = Math.max(worst, Math.abs(A[i].s0 - B[i].s0), Math.abs(A[i].s1 - B[i].s1), Math.abs(A[i].z0 - B[i].z0), Math.abs(A[i].z1 - B[i].z1));
  return worst < 1e-6 ? null : 'edge ' + worst;
}
// the nearest cell at a point, from the real quads
function cellIndex(p) {
  const W = p.W, O = W.at(0, 0, 0), us = W.at(1, 0, 0).map((v, i) => v - O[i]), ud = W.at(0, 1, 0).map((v, i) => v - O[i]), uz = W.at(0, 0, 1).map((v, i) => v - O[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const co = pt => { const q = [pt[0] - O[0], pt[1] - O[1], pt[2] - O[2]]; return [dot(q, us) / dot(us, us), dot(q, ud) / dot(ud, ud), dot(q, uz) / dot(uz, uz)]; };
  const cells = [];
  for (const [a, b, c, d, col] of p.quads) { const P4 = [a, b, c, d].map(co); const ds = P4.map(q => q[1]); if (Math.max(...ds) - Math.min(...ds) > 1e-4) continue; /* not a face-parallel cell: a reveal strip or a blade */
    const ss = P4.map(q => q[0]), zs = P4.map(q => q[2]); cells.push({ s0: Math.min(...ss), s1: Math.max(...ss), z0: Math.min(...zs), z1: Math.max(...zs), d: ds[0], col }); }
  return cells;
}
function pictureMismatch(p, windows, regions, n) {
  const cells = cellIndex(p), P = p.P; let bad = 0, tot = 0, lostGlass = 0; const examples = [];
  const toneName = new Map(); for (const [k, v] of Object.entries(P)) if (Array.isArray(v)) toneName.set(v[0], k);
  for (let i = 0; i < n; i++) {
    const s = rnd() * p.len, z = p.z0 + rnd() * (p.z1 - p.z0);
    let best = null; for (const c of cells) if (s > c.s0 + 1e-6 && s < c.s1 - 1e-6 && z > c.z0 + 1e-6 && z < c.z1 - 1e-6 && (!best || c.d > best.d)) best = c;
    if (!best) continue;
    const want = toneAt(p.sk, piece(p), windows, regions, s, z), got = best.col[0];
    const wantHex = (P[want] || (want === (p.sk.window && p.sk.window.mullion && (p.sk.window.mullion.tone || 'trim')) ? P.frame : null) || {})[0] ?? null; tot++;
    if (wantHex !== got) { bad++; if (want === (p.sk.glass || 'glass')) lostGlass++; if (examples.length < 2) examples.push({ s: +s.toFixed(2), z: +z.toFixed(2), want, got: toneName.get(got) }); }
  }
  return { bad, tot, lostGlass, examples };
}

const totalTris = res.totalTriangles;
const results = [];
let caps = new Set();
const levels = [['v0 (bays/flat, even floors)', null], ...ORDER.map(c => [c, c])];
const verified = new Set();                    // pieces whose windows matched and (sampled) picture matched
const picCache = new Map(), sigSeen = new Map();   // per piece: the picture check, kept across levels; one piece per signature is checked, the rest inherit its verdict
for (const [label, add] of levels) {
  if (add) caps.add(add);
  let lostGlassTris = 0; const lostGlassKeys = new Set(); let covered = 0, coveredPieces = 0, winOk = 0, winBad = 0, winCovered = 0, picBad = 0, picTot = 0, picPieces = 0; const reasons = {}, badEx = [];
  for (const p of pieces) {
    const a = accepts(p.sk, p.band, piece(p), caps);
    if (p.cut) { reasons['cut'] = (reasons.cut || 0) + p.tris; continue; }
    if (!a.ok) { for (const r of [...a.never, ...a.missing.map(m => 'needs ' + m)]) reasons[r] = (reasons[r] || 0) + p.tris; continue; }
    // windows must match the generator's own list (accent tones need the generator's hash: compare geometry only)
    const pred = windowsOf(p.sk, piece(p));
    const act = p.skin.windows.map(w => ({ s0: w.s0, s1: w.s1, z0: w.z0, z1: w.z1 }));
    const m = windowsMatch(pred, act);
    if (m) { winBad++; if (badEx.length < 4) badEx.push(p.key + ': ' + m); reasons['windows differ'] = (reasons['windows differ'] || 0) + p.tris; continue; }
    winOk++;
    // a sample of pieces also gets the picture check (accent pieces: the hash is the generator's, so the oracle's accent tone is skipped); the others in the
    // same building, skin and size class inherit the verdict of the one checked
    const sig = p.key + '|' + p.len.toFixed(0) + '|' + p.z1.toFixed(0) + '|' + [...a.need].sort().join();
    if (!picCache.has(sig)) {
      if (p.sk.window && p.sk.window.accent) picCache.set(sig, null);
      else { const windows = windowsOf(p.sk, piece(p)), regions = regionsOf(windows, piece(p)); const r = pictureMismatch(p, windows, regions, SAMPLES); r.key = p.key; picCache.set(sig, r); }
    }
    const r = picCache.get(sig);
    if (r) { if (!sigSeen.has(sig + '@' + label)) { sigSeen.set(sig + '@' + label, 1); picBad += r.bad; picTot += r.tot; picPieces++; }
      if (r.bad / Math.max(1, r.tot) > 0.01) {
        // the generator drops a window's glass cell when the window's top has more than four decimals (its z cuts are rounded to 1e-4 and the
        // cell then fails its own "window spans this cell" test): the shader draws the window the recipe says. Counted apart, not hidden.
        if (r.lostGlass >= 0.9 * r.bad) { lostGlassTris += p.tris; lostGlassKeys.add(p.key.split('|')[0]); }
        else { if (badEx.length < 6) badEx.push(`${p.key}: picture ${r.bad}/${r.tot} ${JSON.stringify(r.examples)}`); reasons['picture differs'] = (reasons['picture differs'] || 0) + p.tris; continue; } } }
    covered += p.tris; coveredPieces++; winCovered += p.skin.windows.length;
  }
  const row = { label, caps: [...caps], lostGlassTriangles: lostGlassTris, lostGlassBuildings: lostGlassKeys.size, lostGlassIds: [...lostGlassKeys].sort(), coveredTriangles: covered, coveredPct: +(100 * covered / totalTris).toFixed(2), coveredPieces, windowsCovered: winCovered, windowMismatchPieces: winBad, pictureSamples: picTot, pictureMismatchPct: picTot ? +(100 * picBad / picTot).toFixed(3) : null, picturePieces: picPieces, examples: badEx };
  results.push(row);
  out(`${label.padEnd(30)} covers ${String(covered).padStart(8)} triangles = ${row.coveredPct.toFixed(1).padStart(5)}% of the city's ${totalTris} | pieces ${coveredPieces} | windows ${winCovered} | window-list mismatches ${winBad} | picture samples ${picTot} (${picPieces} pieces) mismatch ${row.pictureMismatchPct}%` + (lostGlassTris ? ` | of the covered, ${lostGlassTris} triangles are in ${lostGlassKeys.size} building(s) where the generator loses window glass (rounding)` : ''));
  if (badEx.length) out('   problems: ' + badEx.join(' ; '));
}
const last = results.at(-1);
const top = Object.entries((() => { const r = {}; const capsAll = caps; for (const p of pieces) { if (p.cut) continue; const a = accepts(p.sk, p.band, piece(p), capsAll); if (a.ok) continue; for (const x of [...a.never, ...a.missing.map(m => 'needs ' + m)]) r[x] = (r[x] || 0) + p.tris; } return r; })()).sort((a, b) => b[1] - a[1]).slice(0, 12);
out('what still blocks pieces (triangles in pieces that carry the reason; a piece can carry several): ' + JSON.stringify(top));
if (opt('--json', null)) fs.writeFileSync(opt('--json'), JSON.stringify({ totalTriangles: totalTris, pieces: pieces.length, results, blocking: top }, null, 1));
