/**
 * node/verify-module.mjs - the IN-APP module (js/facet-walls.js) against the REAL generator over the whole catalog, in Node.
 * Every wall piece the cell tiler cuts is offered to FACET.take() exactly as the hook in drawWall offers it. For every piece it TAKES:
 *   - PICTURE: the CPU twin of the shader (fieldNameAt over the packed data) paints the same tone as the cell the generator emitted, at sampled points
 *   - NIGHT:   the glass cell's night colour in the window table equals the night colour of the generator's glass cell
 * and it reports what share of the city's triangles the module takes (the in-app coverage) and why it refuses the rest.
 *   node experiments/facet/node/verify-module.mjs [--samples 60] [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tapCatalog } from './tap.mjs';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SAMPLES = +opt('--samples', '60');
const out = s => process.stdout.write(s + '\n');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let FACET = null, APTS = null, C = null;
const rnd = (() => { let x = 99; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; })();
const taken = [];
let totalPieceTris = 0, takenTris = 0;
const res = await tapCatalog(rec => {
  totalPieceTris += rec.tris;
  const pane = P => P[rec.sk.glass || 'glass'] || P.glass;
  const skinReveal = rec.skin.reveal != null ? rec.skin.reveal : APTS.reveal;
  const ok = C.take({ W: rec.W, len: rec.len, z0: rec.z0, z1: rec.z1, ctx: rec.ctx, skin: rec.skin, sk: rec.sk, band: rec.band, P: rec.P, cut: rec.cut, skinReveal, tris: rec.tris,
    windowNight: (w, glass) => w.lit ? (w.nightTone || APTS.nightLitTone) : glass[2], filtered: process.argv.includes('--keep-filtered') && ['Union on 24th', '21 Rio', 'The Standard', 'Villas on Rio', 'Yugo Austin Waterloo'].includes(rec.spec.name) });
  if (ok) { takenTris += rec.tris; taken.push({ rec, pk: C.debug.at(-1).pk }); }
}, { quads: true, setup: async ({ A }) => {
  APTS = A.APTS; globalThis.window = globalThis;
  await import(path.join(REPO, 'js/facet-walls.js') + '?v=' + Date.now());
  FACET = globalThis.FACET; C = FACET.collector(); C.debug = [];
} });
out(`generator ran: ${res.totalTriangles} triangles; wall pieces ${C.stats.pieces}, taken ${C.stats.taken}; triangles in taken pieces ${takenTris} = ${(100 * takenTris / res.totalTriangles).toFixed(1)}% of the city (the cell tiler cut ${(100 * totalPieceTris / res.totalTriangles).toFixed(1)}%); windows ${C.stats.windows}; self-check refused ${C.stats.selfCheckRefused}`);
const top = Object.entries(C.stats.refused).sort((a, b) => b[1] - a[1]).slice(0, 14);
out('refused (pieces): ' + JSON.stringify(top));
// picture and night checks
function cellsOf(rec) {
  const W = rec.W, O = W.at(0, 0, 0), us = W.at(1, 0, 0).map((v, i) => v - O[i]), ud = W.at(0, 1, 0).map((v, i) => v - O[i]), uz = W.at(0, 0, 1).map((v, i) => v - O[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const co = pt => { const q = [pt[0] - O[0], pt[1] - O[1], pt[2] - O[2]]; return [dot(q, us) / dot(us, us), dot(q, ud) / dot(ud, ud), dot(q, uz) / dot(uz, uz)]; };
  const cells = [];
  for (const [a, b, c, d, col] of rec.quads) { const P4 = [a, b, c, d].map(co); const ds = P4.map(q => q[1]); if (Math.max(...ds) - Math.min(...ds) > 1e-4) continue; const ss = P4.map(q => q[0]), zs = P4.map(q => q[2]); cells.push({ s0: Math.min(...ss), s1: Math.max(...ss), z0: Math.min(...zs), z1: Math.max(...zs), d: ds[0], col }); }
  return cells;
}
let pts = 0, bad = 0, winPts = 0, nightBad = 0, lostGlassPieces = 0, nonWin = 0; const ex = [], byFeat = {};
const { fieldNameAt, winAt } = C._eval;
const seen = new Map();
for (const { rec, pk } of taken) {
  const cells = cellsOf(rec); let pb = 0, pt = 0, lost = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const s = rnd() * rec.len, z = rec.z0 + rnd() * (rec.z1 - rec.z0);
    let best = null; for (const c of cells) if (s > c.s0 + 1e-6 && s < c.s1 - 1e-6 && z > c.z0 + 1e-6 && z < c.z1 - 1e-6 && (!best || c.d > best.d)) best = c;
    if (!best) continue;
    const want = fieldNameAt(pk, s, z), w = winAt(pk, s, z);
    pt++; pts++;
    if (best.col[0] !== want[0]) { pb++; bad++; if (w == null) { nonWin++; const f = rec.sk.window ? Object.keys(rec.sk.window).filter(k => !['w','h','sill'].includes(k)).join('+') || 'plain window' : 'no window'; byFeat[f] = (byFeat[f] || 0) + 1; } if (w == null && ex.length < 6) ex.push({ key: rec.key, s: +s.toFixed(2), z: +z.toFixed(2), want: want[0], got: best.col[0] }); else if (w) lost++; }
    else if (w) { winPts++; const nh = w.cell; const hx = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)); const g = hx(best.col[2] || best.col[0]); if (Math.abs(g[0] - nh[0]) + Math.abs(g[1] - nh[1]) + Math.abs(g[2] - nh[2]) > 3) nightBad++; }
  }
  if (pt && pb / pt > 0.05 && lost >= 0.9 * pb) lostGlassPieces++;
}
out(`picture check: ${pts} sampled points on ${taken.length} taken pieces, ${bad} differ (${(100 * bad / Math.max(1, pts)).toFixed(3)}%) of which ${lostGlassPieces} pieces are the generator's lost-glass defect; night colour of ${winPts} glass points: ${nightBad} differ`);
out(`   mismatching points away from windows: ${nonWin}; by skin features: ${JSON.stringify(byFeat)}`);
if (ex.length) out('   examples: ' + JSON.stringify(ex));
if (opt('--json', null)) fs.writeFileSync(opt('--json'), JSON.stringify({ totalTriangles: res.totalTriangles, takenTriangles: takenTris, takenPct: +(100 * takenTris / res.totalTriangles).toFixed(2), pieces: C.stats.pieces, taken: C.stats.taken, refused: C.stats.refused, pictureSamples: pts, pictureMismatch: bad, nightSamples: winPts, nightMismatch: nightBad }, null, 1));
