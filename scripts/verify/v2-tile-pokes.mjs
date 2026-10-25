// v2-tile-pokes.mjs - parts of one Blender model that stand up through another Blender model's roof, over EVERY tile (no browser, no
// GPU, no server; about 10 s).
//   node scripts/verify/v2-tile-pokes.mjs [--tiles DIR] [--far]        (Node >=22.15; DIR = a folder holding a manifest.json and its tiles)
//
// 2026-10-24: DKR's guessed entry-pavilion canopy (a 34 m slab, 12.4 m falling to 10.2 m) stood 0.3-0.5 m above Moncrief-Neuhaus's red
// hall roof (12.0-12.4 m) and drew as a tan patch on it. Nothing in the app could see it: each model is fine alone, the fault is the two
// together. The rule (lib/v2-pokes.mjs): a part of model A whose up-facing surface CROSSES model B's roof inside B's interior (part
// buried, part showing) is a poke. This lists every one in every tile, and every pair of models that overlap deeper than that
// ("deep": two buildings in one place, not a part poking; listed, not failed).
//   - a poke listed in scripts/v2/tile_clips.json "clips" must already be hidden in the shipped tile (scripts/v2/clip_tiles.mjs);
//   - a poke in "known" is listed (nobody has decided what is right);
//   - any other poke fails the run and prints the clip entry to add.
// --far checks the far files (lod1) instead of the near ones.
import fs from 'node:fs';
import path from 'node:path';
import { loadTileTriangles, url } from './lib/v2-world.mjs';
import { findPokes } from './lib/v2-pokes.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const dir = opt('--tiles') ? path.resolve(opt('--tiles')) : null;
const FAR = argv.includes('--far');
const manifest = JSON.parse(fs.readFileSync(dir ? path.join(dir, 'manifest.json') : url('v2/tiles/manifest.json'), 'utf8'));
const clipsFile = JSON.parse(fs.readFileSync(url('scripts/v2/tile_clips.json'), 'utf8'));

const t0 = Date.now(), all = [];
for (const tile of manifest.tiles) {
  const rel = FAR ? tile.lod1 : tile.lod0;
  for (const b of await loadTileTriangles(tile, dir ? path.join(dir, path.basename(rel)) : rel)) all.push({ ...b, tile: tile.id });
}
const { pokes, deep } = findPokes(all);
const tris = all.reduce((m, b) => m + b.tris.length / 9, 0);
console.log(`${FAR ? 'far' : 'near'} files: ${all.length} buildings, ${tris} triangles, ${manifest.tiles.length} tiles, read and checked in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const same = (a, p) => a.slug === p.slug && a.over === p.over && a.tile === p.tile;
const known = pokes.filter((p) => (clipsFile.known || []).some((k) => same(k, p)));
const unapplied = pokes.filter((p) => (clipsFile.clips || []).some((c) => same(c, p)));
const bad = pokes.filter((p) => !known.includes(p) && !unapplied.includes(p));
const pairs = new Map();
for (const d of deep) { const k = `${d.slug} over ${d.over}`; const e = pairs.get(k) || { parts: 0, tris: 0, above: 0 }; e.parts++; e.tris += d.tris; e.above = Math.max(e.above, d.above); pairs.set(k, e); }

console.log(`PARTS POKING THROUGH A NEIGHBOUR'S ROOF: ${pokes.length} (${bad.length} not decided, ${unapplied.length} to be clipped but still showing, ${known.length} listed as known)`);
for (const p of pokes) console.log(`  ${known.includes(p) ? 'known' : unapplied.includes(p) ? 'CLIP ' : 'NEW  '} ${p.slug} over ${p.over} (${p.tile}): ${p.tris} triangles, ${p.above} m above the roof, ${-p.below} m under it, box ${JSON.stringify(p.box)}`);
console.log(`models overlapping deeper (two buildings in one place, listed only): ${pairs.size} pairs`);
for (const [k, e] of pairs) console.log(`  ${k}: ${e.parts} parts, ${e.tris} triangles, up to ${e.above} m above`);

// every clip in tile_clips.json is in force: its part is not in the shipped tile any more (it would be listed above) and its box is empty of
// the part. (The pipeline stage refuses to run when the box holds another number of triangles than the file says.)
const missing = FAR ? 0 : unapplied.length;
for (const p of FAR ? [] : unapplied) console.log(`CLIP NOT APPLIED: ${p.slug} over ${p.over} in ${p.tile}: run node scripts/v2/clip_tiles.mjs`);
if (bad.length) {
  console.log('\nTo hide a part that is wrong, add it to scripts/v2/tile_clips.json "clips" (seed = a corner of the part; the stage takes the triangles joined to it inside the box); if nobody can say what is right, add it to "known":');
  for (const p of bad) console.log(JSON.stringify({ slug: p.slug, over: p.over, tile: p.tile, seed: p.seed, box: p.box.map((v, i) => +(v + (i < 3 ? -0.05 : 0.05)).toFixed(2)), tris: p.tris, why: '...' }));
}
if (bad.length || missing) { console.log(`FAIL ${bad.length} parts poke through a roof and nobody has decided`); process.exit(1); }
console.log(`PASS no part pokes through another model's roof except the ${known.length} listed as known`);
