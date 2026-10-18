// v2 tiles, the APP COPY of a build: the detailed model (the builder's .blend, exported in full to <slug>.near.glb) stays as it is; the copy the
// tiles carry is made from it AFTERWARDS, here (owner rule, CLAUDE.md 2026-10-17: no triangle limit on a build; the light app copy is made
// from the detailed model). Only the builds named in scripts/v2/app_copy.json get one; every other build's near file goes into its tile whole.
//
//   1. SITE GRADING. The builder lays the lot's ground (scan terrain, paving) in the build's own heights: for DKR it is 4.5 km across and
//      rises 14 m. The v2 app's ground is flat (y = 0, no elevation model), so: ground pieces (materials named site_*) are kept only within
//      skirt_m of the building proper, their height above the field fades to 0 between flat_m and skirt_m (so a wall that stands on a slope
//      still meets a ground that rises to it, and the rise dies out into the app's flat ground), and every ground triangle that ends up
//      lower than min_m above the ground is dropped (the app's own ground is there; two surfaces in one plane flicker, rule 15).
//   2. SIMPLIFY to a triangle target: meshoptimizer, one error number for the whole build, found by bisection. Detail thinner than the
//      error disappears first (rails, letters, window frames), which is also what keeps it steady from far away; large forms and the
//      silhouette stay.
import { weld, simplify, simplifyPrimitive, reorder, prune } from '@gltf-transform/functions';

// distance (m) from every grid cell to the nearest occupied cell: two-pass chamfer on a CELL-metre raster
function distanceField(occ, W, H, cell) {
  const d = new Float32Array(W * H); const BIG = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = occ[i] ? 0 : BIG;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? BIG : d[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    d[y * W + x] = Math.min(d[y * W + x], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4142, at(x + 1, y - 1) + 1.4142);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    d[y * W + x] = Math.min(d[y * W + x], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4142, at(x - 1, y + 1) + 1.4142);
  }
  for (let i = 0; i < d.length; i++) d[i] *= cell;
  return d;
}

const prims = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
const isSite = (p, re) => re.test((p.getMaterial() && p.getMaterial().getName()) || '');

function smooth(a) { const t = Math.min(Math.max(a, 0), 1); return t * t * (3 - 2 * t); }

export function gradeSite(doc, P) {
  const re = new RegExp(P.site_material, 'i');
  const all = prims(doc); const stats = { site_prims: 0, site_tris_before: 0, site_tris_after: 0, building_tris: 0 };
  // occupancy of the building proper (everything that is not site ground): vertices, triangle middles and edge middles, one cell each
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const pts = [];
  for (const p of all) {
    if (isSite(p, re)) continue;
    const A = p.getAttribute('POSITION').getArray(); const I = p.getIndices().getArray(); stats.building_tris += I.length / 3;
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
      const px = [A[v[0]], A[v[1]], A[v[2]]]; const pz = [A[v[0] + 2], A[v[1] + 2], A[v[2] + 2]];
      for (let k = 0; k < 3; k++) { pts.push(px[k], pz[k], (px[k] + px[(k + 1) % 3]) / 2, (pz[k] + pz[(k + 1) % 3]) / 2); }
      pts.push((px[0] + px[1] + px[2]) / 3, (pz[0] + pz[1] + pz[2]) / 3);
    }
  }
  for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
  const cell = P.cell_m, pad = P.skirt_m + 4 * cell;
  const gx0 = x0 - pad, gz0 = z0 - pad; const W = Math.ceil((x1 - x0 + 2 * pad) / cell) + 1, H = Math.ceil((z1 - z0 + 2 * pad) / cell) + 1;
  const occ = new Uint8Array(W * H);
  for (let i = 0; i < pts.length; i += 2) occ[Math.floor((pts[i + 1] - gz0) / cell) * W + Math.floor((pts[i] - gx0) / cell)] = 1;
  const D = distanceField(occ, W, H, cell);
  const dist = (x, z) => { const cx = Math.floor((x - gx0) / cell), cz = Math.floor((z - gz0) / cell); return cx < 0 || cz < 0 || cx >= W || cz >= H ? Infinity : D[cz * W + cx]; };
  stats.footprint_m = [+(x1 - x0).toFixed(1), +(z1 - z0).toFixed(1)];
  for (const p of all) {
    if (!isSite(p, re)) continue;
    const pa = p.getAttribute('POSITION'); const A = pa.getArray(); const idx = p.getIndices(); const I = idx.getArray();
    const n = A.length / 3; const d = new Float32Array(n); const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      d[i] = dist(A[3 * i], A[3 * i + 2]);
      const w = 1 - smooth((d[i] - P.flat_m) / (P.skirt_m - P.flat_m));   // 1 up to flat_m, 0 at skirt_m
      y[i] = A[3 * i + 1] > 0 ? A[3 * i + 1] * w : A[3 * i + 1];           // (lower than the field: under the app's ground, which hides it)
    }
    const keep = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      if (d[a] > P.skirt_m || d[b] > P.skirt_m || d[c] > P.skirt_m) continue;
      if (Math.max(y[a], y[b], y[c]) < P.min_m) continue;
      keep.push(a, b, c);
    }
    stats.site_prims++; stats.site_tris_before += I.length / 3; stats.site_tris_after += keep.length / 3;
    for (let i = 0; i < n; i++) A[3 * i + 1] = y[i];
    pa.setArray(A);
    // vertex normals of the graded ground (area weighted)
    const N = new Float32Array(n * 3);
    for (let t = 0; t < keep.length; t += 3) {
      const a = keep[t], b = keep[t + 1], c = keep[t + 2];
      const ux = A[3 * b] - A[3 * a], uy = A[3 * b + 1] - A[3 * a + 1], uz = A[3 * b + 2] - A[3 * a + 2];
      const vx = A[3 * c] - A[3 * a], vy = A[3 * c + 1] - A[3 * a + 1], vz = A[3 * c + 2] - A[3 * a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const i of [a, b, c]) { N[3 * i] += nx; N[3 * i + 1] += ny; N[3 * i + 2] += nz; }
    }
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(N[3 * i], N[3 * i + 1], N[3 * i + 2]) || 1; const s = N[3 * i + 1] < 0 ? -1 : 1;   // (always facing up)
      N[3 * i] = s * N[3 * i] / l; N[3 * i + 1] = s * N[3 * i + 1] / l; N[3 * i + 2] = s * N[3 * i + 2] / l;
    }
    p.getAttribute('NORMAL').setArray(N);
    idx.setArray(new Uint32Array(keep));
    if (!keep.length) { for (const m of doc.getRoot().listMeshes()) if (m.listPrimitives().includes(p)) m.removePrimitive(p); p.dispose(); }
  }
  return stats;
}

// the exporter's normals are flat or smooth per face corner, so every edge is a "seam" the simplifier will not collapse across. The copy is
// simplified on welded POSITIONS only and shaded again afterwards: a corner takes the area-weighted normal of the faces at its position
// whose own normal is within crease_deg of its face (so edges sharper than that stay hard, round parts stay round).
export function shade(doc, creaseDeg) {
  const cosC = Math.cos(creaseDeg * Math.PI / 180);
  for (const p of prims(doc)) {
    const pa = p.getAttribute('POSITION'); const A = pa.getArray(); const I = p.getIndices().getArray(); const nt = I.length / 3;
    const fn = new Float32Array(nt * 3);                       // area-weighted face normals
    const byV = Array.from({ length: A.length / 3 }, () => []);
    for (let t = 0; t < nt; t++) {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      const ux = A[3 * b] - A[3 * a], uy = A[3 * b + 1] - A[3 * a + 1], uz = A[3 * b + 2] - A[3 * a + 2];
      const vx = A[3 * c] - A[3 * a], vy = A[3 * c + 1] - A[3 * a + 1], vz = A[3 * c + 2] - A[3 * a + 2];
      fn[3 * t] = uy * vz - uz * vy; fn[3 * t + 1] = uz * vx - ux * vz; fn[3 * t + 2] = ux * vy - uy * vx;
      byV[a].push(t); byV[b].push(t); byV[c].push(t);
    }
    const unit = (t) => { const l = Math.hypot(fn[3 * t], fn[3 * t + 1], fn[3 * t + 2]) || 1; return [fn[3 * t] / l, fn[3 * t + 1] / l, fn[3 * t + 2] / l]; };
    const P3 = new Float32Array(nt * 9), N3 = new Float32Array(nt * 9), I3 = new Uint32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const nu = unit(t);
      for (let k = 0; k < 3; k++) {
        const v = I[3 * t + k]; let sx = 0, sy = 0, sz = 0;
        for (const u of byV[v]) { const mu = unit(u); if (mu[0] * nu[0] + mu[1] * nu[1] + mu[2] * nu[2] >= cosC) { sx += fn[3 * u]; sy += fn[3 * u + 1]; sz += fn[3 * u + 2]; } }
        const l = Math.hypot(sx, sy, sz) || 1;
        P3.set([A[3 * v], A[3 * v + 1], A[3 * v + 2]], 9 * t + 3 * k); N3.set([sx / l, sy / l, sz / l], 9 * t + 3 * k);
        I3[3 * t + k] = 3 * t + k;
      }
    }
    pa.setArray(P3);
    p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N3).setBuffer(pa.getBuffer()));
    p.getIndices().setArray(I3);
  }
}

// two_sided: a surface the builder modelled with its faces wound away from the viewer (Blender draws both sides; the app draws the front only,
// so a roof wound downward is not drawn at all from above): each triangle of the materials named is added again with the other winding
export function twoSided(doc, re) {
  let added = 0;
  for (const p of prims(doc)) {
    if (!re.test((p.getMaterial() && p.getMaterial().getName()) || '')) continue;
    const idx = p.getIndices(), I = idx.getArray(); const O = new Uint32Array(I.length * 2); O.set(I);
    for (let t = 0; t < I.length; t += 3) { O[I.length + t] = I[t]; O[I.length + t + 1] = I[t + 2]; O[I.length + t + 2] = I[t + 1]; }
    idx.setArray(O); added += I.length / 3;
  }
  return added;
}

const triCount = (doc) => prims(doc).reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);

// src .glb (the full detailed export) -> dst .glb (the app copy); returns the numbers
export async function makeAppCopy({ io, MeshoptSimplifier, MeshoptEncoder, src, dst, dstMass, dstFarKeep, dstFarCopy, spec }) {
  const P = spec.site;
  const doc0 = await io.read(src);
  const stats = { detailed_tris: triCount(doc0) };
  stats.grading = gradeSite(doc0, P);
  // lift: a surface that lies exactly in the app's ground plane (a field's turf at y = 0) is raised to a floor height, or it z-fights the ground
  for (const [mat, y0] of Object.entries(spec.lift || {})) {
    const re = new RegExp(mat, 'i');
    for (const p of prims(doc0)) {
      if (!isSite(p, re)) continue;
      const pa = p.getAttribute('POSITION'); const A = pa.getArray();
      for (let i = 1; i < A.length; i += 3) if (A[i] < y0) A[i] = y0;
      pa.setArray(A);
    }
  }
  // far_keep: surfaces the far (lod1) file carries besides the mass (a field's turf; a distance band that stands in for fins), taken from here
  // before the copy is simplified; lod0_drop: surfaces that are for the far file only and stay out of the near copy
  if (spec.far_keep && dstFarKeep) {
    const fk = await io.readBinary(await io.writeBinary(doc0)); const re = new RegExp(spec.far_keep, 'i');
    for (const p of prims(fk)) if (!re.test((p.getMaterial() && p.getMaterial().getName()) || '')) { for (const m of fk.getRoot().listMeshes()) if (m.listPrimitives().includes(p)) m.removePrimitive(p); p.dispose(); }
    await fk.transform(prune());
    const fsx = await import('node:fs'); fsx.writeFileSync(dstFarKeep + '.tmp', await io.writeBinary(fk)); fsx.renameSync(dstFarKeep + '.tmp', dstFarKeep);
  }
  if (spec.lod0_drop) {
    const re = new RegExp(spec.lod0_drop, 'i');
    for (const p of prims(doc0)) if (re.test((p.getMaterial() && p.getMaterial().getName()) || '')) { for (const m of doc0.getRoot().listMeshes()) if (m.listPrimitives().includes(p)) m.removePrimitive(p); p.dispose(); }
  }
  // far_copy: a far file made from this model instead of the mass (a build whose look is its overhang over a dark facade, which a mass of
  // walls at the roof edge hides): the thin and fine parts (regex far_copy.drop) taken out, the rest simplified to far_copy.triangles
  const reduce = async (buf, target, tag) => {
    const trial = async (error) => { const d = await io.readBinary(buf); await d.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0, error }), reorder({ encoder: MeshoptEncoder })); return d; };
    let lo = 1e-5, hi = 0.3, best = null;
    for (let it = 0; it < 12; it++) {
      const e = Math.sqrt(lo * hi); const d = await trial(e); const n = triCount(d);
      if (n >= target) { lo = e; best = { d, n, e }; } else hi = e;
      if (best && Math.abs(best.n - target) / target < 0.02) break;
    }
    if (!best) { const d = await trial(lo); best = { d, n: triCount(d), e: lo }; }
    return best;
  };
  if (spec.far_copy && dstFarCopy) {
    const fc = await io.readBinary(await io.writeBinary(doc0)); const re = new RegExp(spec.far_copy.drop, 'i'); const fsx = await import('node:fs');
    for (const p of prims(fc)) if (re.test((p.getMaterial() && p.getMaterial().getName()) || '')) { for (const m of fc.getRoot().listMeshes()) if (m.listPrimitives().includes(p)) m.removePrimitive(p); p.dispose(); }
    await fc.transform(prune());
    for (const p of prims(fc)) p.setAttribute('NORMAL', null);
    await fc.transform(weld(), reorder({ encoder: MeshoptEncoder }));
    const best = await reduce(await io.writeBinary(fc), spec.far_copy.triangles);
    if (spec.two_sided) stats.two_sided_far = twoSided(best.d, new RegExp(spec.two_sided, 'i'));
    shade(best.d, spec.crease_deg || 35); await best.d.transform(weld());
    fsx.writeFileSync(dstFarCopy + '.tmp', await io.writeBinary(best.d)); fsx.renameSync(dstFarCopy + '.tmp', dstFarCopy);
    stats.far_copy_tris = best.n;
  }
  for (const p of prims(doc0)) p.setAttribute('NORMAL', null);
  await doc0.transform(weld(), reorder({ encoder: MeshoptEncoder }));
  stats.graded_tris = triCount(doc0);
  const graded = await io.writeBinary(doc0);
  // reduce: only the materials named are simplified (fine repeats: window frames, rails, lamps); every other surface keeps its triangles whole
  // (letters, field markings, seat tiers, aisles, signs: the simplifier breaks their shapes and the thin layers laid over a surface)
  const reduceRe = spec.reduce ? new RegExp(spec.reduce, 'i') : null;
  const trial = async (error) => {
    const d = await io.readBinary(graded);
    if (!reduceRe) await d.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0, error }), reorder({ encoder: MeshoptEncoder }));
    else {
      for (const p of prims(d)) if (reduceRe.test((p.getMaterial() && p.getMaterial().getName()) || '')) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: 0, error, lockBorder: false });
      await d.transform(reorder({ encoder: MeshoptEncoder }));
    }
    return d;
  };
  // bisection on the error (log scale): the largest error that keeps at least `triangles`
  let lo = 1e-5, hi = 0.2, best = null;
  for (let it = 0; it < 12; it++) {
    const e = Math.sqrt(lo * hi); const d = await trial(e); const n = triCount(d);
    if (n >= spec.triangles) { lo = e; best = { d, n, e }; } else hi = e;
    if (best && Math.abs(best.n - spec.triangles) / spec.triangles < 0.02) break;
  }
  if (!best) { const d = await trial(lo); best = { d, n: triCount(d), e: lo }; }
  stats.app_tris = best.n; stats.simplify_error = +best.e.toFixed(6);
  if (spec.two_sided) stats.two_sided_near = twoSided(best.d, new RegExp(spec.two_sided, 'i'));
  shade(best.d, spec.crease_deg || 35);
  await best.d.transform(weld());
  const bin = await io.writeBinary(best.d);
  const tmp = dst + '.tmp'; (await import('node:fs')).writeFileSync(tmp, bin); (await import('node:fs')).renameSync(tmp, dst);
  stats.bytes_uncompressed = bin.byteLength;
  // the same copy without its ground: lod1 (the far mass) is made from this one, or the mass would take the graded ground for a building
  if (dstMass) {
    const d = await io.readBinary(bin); const re = new RegExp(P.site_material, 'i');
    for (const p of prims(d)) if (isSite(p, re)) { for (const m of d.getRoot().listMeshes()) if (m.listPrimitives().includes(p)) m.removePrimitive(p); p.dispose(); }
    const fs = await import('node:fs'); fs.writeFileSync(dstMass + '.tmp', await io.writeBinary(d)); fs.renameSync(dstMass + '.tmp', dstMass);
  }
  return stats;
}
