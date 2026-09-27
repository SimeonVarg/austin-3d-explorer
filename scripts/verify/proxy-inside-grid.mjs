// The shadow proxy's authored-footprint test is a grid lookup (js/city-lighting.js
// footprintLookup). It must give EXACTLY the answer of the scan it replaced,
// rings.some(r=>inside(centre,r)), for every caster centre, or the proxy
// changes: a caster wrongly kept double-casts under its authored mesh, one
// wrongly dropped leaves a hole in the shadows.
//
// No browser, no server. Runs the real footprintLookup and insideRing from
// js/city-lighting.js against the real data: every authored footprint (the core
// catalogue, then core + every on-demand area, as desktop holds them once
// Riverside has been visited), and as test points the ring-vertex centre of
// every legacy prism, outer-ring building and building part (what the proxy
// tests), plus an 8 x 8 lattice over each footprint's box, its vertices, and
// points one rounding step either side of its box edges. Also the odd inputs:
// a NaN centre, a ring with a broken vertex, an empty ring, a ring too big to
// file.
//   node proxy-inside-grid.mjs          must exit 0
//   node proxy-inside-grid.mjs --break  files no ring under its last (north-east) cell: must exit 1
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
const src = fs.readFileSync(new URL('js/city-lighting.js', ROOT), 'utf8');
const a = src.indexOf('  const PROXY_GRID_DEG='), b = src.indexOf('  // Debug only (parity checks)', a);
if (a < 0 || b < 0) { console.error('footprintLookup not found in js/city-lighting.js; update this gate'); process.exit(2); }
let code = src.slice(a, b);
const BREAK = process.argv.includes('--break');
if (BREAK) {
  const loop = 'for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){';
  if (!code.includes(loop)) { console.error('--break: filing loop not found; update the sabotage'); process.exit(2); }
  code = code.replace(loop, loop + 'if(i===i1&&j===j1)continue;');
}
const scope = vm.createContext({ Map, Math, Number, Infinity });
vm.runInContext(code + '\nglobalThis.lookup=footprintLookup;globalThis.insideRing=insideRing;globalThis.CELL=PROXY_GRID_DEG;', scope);
const { lookup, insideRing, CELL } = scope;

const J = p => JSON.parse(fs.readFileSync(new URL(p, ROOT), 'utf8'));
const idx = J('data/apartments/index.json');
const spec = f => J(f.startsWith('data/') ? f : 'data/apartments/' + f);
const core = [];
for (const f of idx.buildings || []) core.push(spec(f));
for (const f of idx.collections || []) core.push(...(J(f).buildings || []));
const areas = [];
for (const ar of Object.values(idx.areas || {})) for (const f of ar.collections || []) areas.push(...(J(f).buildings || []));
const ringsOf = list => list.map(x => x.footprint?.ring).filter(Boolean);

const latest = J('data/manifest.json').latest;
const casters = [
  ...J(`data/snapshots/${latest}/buildings.detailed.geojson`).features.filter(f => !f.properties?.has_parts),
  ...J(`data/snapshots/${latest}/parts.detailed.geojson`).features,
  ...J('data/outer_ring.geojson').features,
];
// the proxy's own centre: the mean of the ring's vertices, closing vertex dropped
const centres = [];
for (const f of casters) {
  const g = f.geometry, polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) { const ring = poly[0]; if (!ring?.length) continue;
    centres.push(ring.slice(0, -1).reduce((v, p) => [v[0] + p[0] / (ring.length - 1), v[1] + p[1] / (ring.length - 1)], [0, 0])); }
}
const probes = rings => {
  const pts = [];
  for (const r of rings) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of r) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) pts.push([w + (e - w) * (i + 0.5) / 8, s + (n - s) * (j + 0.5) / 8]);
    for (const p of r) pts.push([p[0], p[1]]);
    for (const x of [w, e]) for (const d of [-1, 1]) pts.push([x + d * Math.abs(x) * Number.EPSILON, (s + n) / 2]);
    for (const y of [s, n]) for (const d of [-1, 1]) pts.push([(w + e) / 2, y + d * Math.abs(y) * Number.EPSILON]);
    // a centre exactly on a cell boundary inside the box
    pts.push([Math.ceil(w / CELL) * CELL, (s + n) / 2], [(w + e) / 2, Math.ceil(s / CELL) * CELL]);
  }
  return pts;
};

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
const compare = (label, rings, pts) => {
  const tb = process.hrtime.bigint(), has = lookup(rings), tBuild = Number(process.hrtime.bigint() - tb) / 1e6;
  let hits = 0, diff = 0, first = null;
  const t0 = process.hrtime.bigint();
  const want = pts.map(p => rings.some(r => insideRing(p, r)));
  const tScan = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  const got = pts.map(p => has(p));
  const tGrid = Number(process.hrtime.bigint() - t1) / 1e6;
  for (let k = 0; k < pts.length; k++) { if (want[k]) hits++; if (want[k] !== got[k]) { diff++; first = first || pts[k]; } }
  check(diff === 0 && hits > 0, `${label}: ${rings.length} rings, ${pts.length} points, ${hits} inside, ${diff} differ${first ? ' (first at ' + first.join(',') + ')' : ''}; scan ${tScan.toFixed(0)} ms, grid ${(tBuild + tGrid).toFixed(1)} ms (build ${tBuild.toFixed(1)})`);
};

const coreRings = ringsOf(core), allRings = ringsOf(core.concat(areas));
check(coreRings.length > 100 && allRings.length > coreRings.length, `footprints: core ${coreRings.length}, core + areas ${allRings.length}`);
compare('core, caster centres', coreRings, centres);
compare('core + areas, caster centres', allRings, centres);
compare('core + areas, lattice, vertices, box edges, cell edges', allRings, probes(allRings));

// odd inputs, each against the scan
const sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]];
const broken = [[-97.74, 30.28], [-97.739, 30.28], [NaN, 30.281], [-97.74, 30.281]];
const odd = [sq(-97.73, 30.29, 0.0004), broken, [], sq(-97.70, 30.25, 0.2)];
const oddPts = [[NaN, NaN], [NaN, 30.28], [-97.7399, 30.2805], [-97.7401, 30.2805], [-97.73, 30.29], [-97.72, 30.26], [-97.9, 30.2], [-97.73, 30.2903]];
compare('odd rings (broken vertex, empty, 40 km box) and a NaN centre', odd, oddPts);

console.log(failed ? `FAIL: ${failed}${BREAK ? ' (--break: expected)' : ''}` : `PASS${BREAK ? ' -- but --break was supposed to fail' : ''}`);
process.exit(failed ? 1 : 0);
