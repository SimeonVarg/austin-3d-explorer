/**
 * facetc.mjs - the Facet compiler's command line.
 *
 *   node experiments/facet/facetc.mjs compile  [--recipe data/apartments/dobie-twenty21.json] [--skin curtain] [--band tower] [--fixture experiments/facade-shader/fixture/dobie-twenty21.json] [--out experiments/facet/dist]
 *   node experiments/facet/facetc.mjs budget   --sweep <lab sweep json> [--gate 1.5] [--out experiments/facet/dist/budget.json]
 *   node experiments/facet/facetc.mjs refuse   (shows which skins of which buildings Facet v0 can and cannot take: the share it covers)
 *
 * compile reads a recipe's skin and writes:
 *   <slug>.facet.json    the IR (what the skin compiles to)
 *   <slug>.vert.glsl, <slug>.frag.glsl   the generated shaders
 *   <slug>.walls.bin, <slug>.walls.json   the wall package: one quad per wall, and the per-wall fit numbers
 * Walls come from the renderer study's fixture (found in the app's own geometry); a production bake takes them from the footprint ring.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromRecipe, emitGLSL, bake, budget } from './lib/facet.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../..');
const argv = process.argv.slice(2), cmd = argv[0], opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(REPO, opt('--out', 'experiments/facet/dist'));

if (cmd === 'compile') {
  const recipePath = path.resolve(REPO, opt('--recipe', 'data/apartments/dobie-twenty21.json')), recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
  const slug = path.basename(recipePath, '.json');
  const fixture = JSON.parse(fs.readFileSync(path.resolve(REPO, opt('--fixture', 'experiments/facade-shader/fixture/' + slug + '.json')), 'utf8'));
  const blk = recipe.blocks.find(b => b.id === opt('--band', 'tower'));
  const skinName = opt('--skin', blk.bands[0].skin);
  const tones = {}; for (const [k, v] of Object.entries(fixture.tones)) tones[fixture.recipe[k + 'Tone'] || k] = v;   // the dump's real day/golden/night triples, by tone name
  let ir;
  try { ir = fromRecipe(recipe, skinName, blk.bands[0], tones); } catch (e) { console.error(e.message); process.exit(e.refused ? 3 : 1); }
  const g = emitGLSL(ir);
  const pkg = bake(ir, fixture.faces);
  fs.mkdirSync(OUT, { recursive: true });
  const w = (n, d) => fs.writeFileSync(path.join(OUT, `${slug}.${n}`), d);
  w('facet.json', JSON.stringify(ir, null, 1)); w('vert.glsl', g.vs + '\n'); w('frag.glsl', g.fs + '\n');
  w('walls.bin', Buffer.concat([Buffer.from(pkg.vertices.buffer), Buffer.from(pkg.indices.buffer)]));
  w('walls.json', JSON.stringify({ vertexFloats: 12, vertexCount: pkg.vertices.length / 12, indexCount: pkg.indices.length, vertexBytes: pkg.vertices.byteLength, faces: pkg.faces, tones: g.tones, light: fixture.light, bbox: fixture.facade.bbox, near: { source: 'the application\'s own generated geometry for this building, unchanged', triangles: fixture.facade.triangles } }));
  const rep = { slug, skin: skinName, layers: ir.layers.map(l => l.op), walls: pkg.faces.length, triangles: pkg.triangles, wallPackageBytes: pkg.bytes, geometryTriangles: fixture.facade.triangles, geometryBytesApp: fixture.facade.appBytes, fragShaderBytes: g.fs.length, vertShaderBytes: g.vs.length };
  w('compile-report.json', JSON.stringify(rep, null, 1));
  console.log(`facetc: ${ir.name}: layers [${rep.layers}] -> ${rep.walls} walls, ${rep.triangles} triangles, ${rep.wallPackageBytes} bytes (geometry: ${rep.geometryTriangles} triangles, ${rep.geometryBytesApp} bytes in the app's arrays); wrote ${OUT}`);
} else if (cmd === 'budget') {
  const sweep = JSON.parse(fs.readFileSync(opt('--sweep'), 'utf8'));
  const b = budget(sweep, +opt('--gate', '1.5'), +opt('--flick-gate', '2.0'));
  fs.mkdirSync(path.dirname(path.resolve(opt('--out', OUT + '/budget.json'))), { recursive: true });
  fs.writeFileSync(path.resolve(opt('--out', OUT + '/budget.json')), JSON.stringify(b, null, 1));
  console.log(`budget: gate ${b.gate} (error ratio) and ${b.flickGate} (flicker ratio); worst error ratio ${b.worstRatioErr.toFixed(2)}, worst flicker ratio ${b.worstRatioFlick.toFixed(2)}; ${b.pass ? 'PASS at every distance swept' : 'outside the gate at ' + b.geometryAtDistances.join(', ') + ' m'}; ${b.note}`);
} else if (cmd === 'refuse') {
  const dir = path.join(REPO, 'data/apartments'); const tally = { accepted: { uses: 0, metres: 0 }, refused: { uses: 0, metres: 0 } }; const why = {}; const byBuilding = [];
  for (const f of fs.readdirSync(dir)) {
    if (f === 'index.json' || !f.endsWith('.json')) continue;
    let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!r.skins || !r.blocks) continue;
    let a = 0, t = 0;
    const uses = []; for (const b of r.blocks) { for (const bd of b.bands || []) uses.push(bd); for (const fc of Object.values(b.faces || {})) for (const bd of (fc && fc.bands) || []) uses.push(bd); }
    for (const bd of uses) {
      const sk = r.skins[bd.skin]; if (!sk || bd.z1 == null) continue; const h = bd.z1 - bd.z0; t += h;
      try { const ir0 = fromRecipe(r, bd.skin, bd); tally.accepted.uses++; tally.accepted.metres += h; a += h; if (ir0.floors.rows > 0) tally.accepted.windowMetres = (tally.accepted.windowMetres || 0) + h; }
      catch (e) { if (!e.refused) continue; tally.refused.uses++; tally.refused.metres += h; for (const x of e.refused) { const k = x.replace(/^kind .* is not.*$/, 'kind is not bays or flat'); why[k] = (why[k] || 0) + 1; } }
    }
    byBuilding.push([r.name, t ? Math.round(100 * a / t) : 0]);
  }
  console.log(`band uses over the catalog: ${tally.accepted.uses} accepted by Facet v0, ${tally.refused.uses} refused; by band height: ${Math.round(100 * tally.accepted.metres / (tally.accepted.metres + tally.refused.metres))}% accepted, of which ${Math.round(100 * (tally.accepted.windowMetres || 0) / (tally.accepted.metres + tally.refused.metres))}% of all height carries windows (the rest is plain wall)`);
  console.log('why refused (a band can have several reasons):', JSON.stringify(why));
  console.log('buildings with the most accepted band height:', JSON.stringify(byBuilding.sort((x, y) => y[1] - x[1]).slice(0, 8)));
} else { console.error('usage: facetc.mjs compile | budget | refuse'); process.exit(2); }
