// Print the loading-screen drawing for js/loader.js.
//   node scripts/loader-art/export.mjs > parts.json         the layers (ART_LAYERS and ART_BOX)
//   node scripts/loader-art/export.mjs model > model.json   the 3D model (ART_MODEL)
// island-gen.mjs draws every layer through one isometric projection; its TOKENS,
// GEO and FLOAT match ART, the geometry and FLOAT in js/loader.js. Paste each layer
// string into ART_LAYERS. The loader builds the halo gradient itself, so the
// halo layer's <defs> is dropped here.
//
// The model is both sides of the main island as the worker in js/loader.js reads
// it: { flip: [i, z], dot, A: [...], B: [...] }, each side a list of records in paint
// order (numbers to 0.01, parents as indices into the same list):
//   ['b', part, [i0, i1, j0, j1, z0, z1], 'top south east', [[face, svg], ...], level, alpha, hidden]
//       (level, alpha: an iceberg ledge's fade group; hidden: the faces, of T L R, the drawing leaves out)
//   ['p', class, [i, j, z, ...], parent]       a flat polygon (a roof plane, the copper cap)
//   ['l', class, [i, j, z, ...], parent, w]    a stroked line (a roof ridge)
//   ['s', [i, j, z], svg, parent]              a sprite: SVG in screen units, pinned to a point
//   ['d', [i, j, z], set, parent]              a route dot
//   ['c', 'side top', [i, j, z], r, h, parent] a drum (the fountain basin)
//   ['e', class, [i, j, z], ra, rb, parent]    a flat ellipse on the ground
import { heroArt, TOKENS, GEO, FLOAT } from './island-gen.mjs';
if (process.argv[2] === 'model') {
  const m = heroArt(TOKENS, GEO, FLOAT, 'model');
  const r2 = v => Math.round(v * 100) / 100;
  const flat = pts => pts.flat().map(r2);
  const enc = r => {
    switch (r.t) {
      case 'b': { const o = ['b', r.part, r.b.map(r2), r.c.join(' '), r.d]; if (r.g || r.h) o.push(r.g || 0, r.g ? r.a : 1); if (r.h) o.push(r.h); return o; }
      case 'p': return ['p', r.c, flat(r.p), r.par];
      case 'l': return ['l', r.c, flat(r.p), r.par, r.w];
      case 's': return ['s', r.a.map(r2), r.s, r.par];
      case 'd': return ['d', r.a.map(r2), r.k, r.par];
      case 'c': return ['c', r.c.join(' '), r.a.map(r2), r2(r.r), r2(r.h), r.par];
      case 'e': return ['e', r.c, r.a.map(r2), +r.ra, +r.rb, r.par];
    }
    throw new Error('unknown record ' + r.t);
  };
  console.log(JSON.stringify({ flip: [GEO.flip.i, GEO.flip.z], dot: GEO.dot, A: m.A.map(enc), B: m.B.map(enc) }));
} else {
  const { layers, BOX } = heroArt(TOKENS, GEO, FLOAT, true);
  layers.halo = layers.halo.replace(/<defs>.*?<\/defs>/, '');
  console.log(JSON.stringify({ layers, BOX }));
}
