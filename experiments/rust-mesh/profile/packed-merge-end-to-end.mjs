// ?packverts=1&packmerge=1 over the WHOLE catalog, no browser: the real generator builds the apartments unpacked (slopes.packSet(false)), then packed and merged
// (several meshes, 16-bit indices, identical vertices stored once). Every triangle, corner by corner, must decode to the unpacked triangle's vertex (position bits,
// normal, three colours, surface, facet). Prints the bytes of both.
//   REAL_NIGHT=1 REAL_PATTERNS=1 REAL_ROOFS=1 THREE_JS=... node profile/packed-merge-end-to-end.mjs
process.env.EXTRA_Q = '&packverts=1&packmerge=1';
const { loadApp } = await import('./app-env.mjs');
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const { A, specs, ctx } = await loadApp({});
const S = ctx.slopes;
S.packSet(false);
const gU = await A.build(specs);
const mU = []; gU.traverse(o => { if (o.isMesh) mU.push(o.geometry); });
if (mU.length !== 1 || mU[0].userData.pack) throw new Error('the unpacked build is not one unpacked mesh');
const U = mU[0], ua = U.attributes, nrm = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = Math.fround(a[i] / 255); return o; };
const un = { normal: ua.normal.array, cDay: nrm(ua.cDay.array), cGold: nrm(ua.cGold.array), cNight: nrm(ua.cNight.array), aFacet: Float32Array.from(ua.aFacet.array), aSurface: ua.aSurface.array };
const bytesU = Object.values(ua).reduce((s, a) => s + a.array.byteLength, 0) + U.index.array.byteLength;
S.packSet(true);
const t0 = performance.now(), gP = await A.build(specs), ms = performance.now() - t0;
const mP = []; gP.traverse(o => { if (o.isMesh) mP.push(o.geometry); });
const T = mP[0].userData.pack, B = S.packInfo().toneBits, TONES = 2 ** B, NLOW = 2 ** (15 - B);
const K = { normal: 3, cDay: 3, cGold: 3, cNight: 3, aFacet: 1, aSurface: 4 };
const bits = a => new Uint32Array(a.buffer, a.byteOffset, a.length), upos = bits(ua.position.array), ub = Object.fromEntries(Object.keys(K).map(n => [n, bits(un[n])]));
let corner = 0, bad = 0, verts = 0, bytesP = T.nTones * 64 + T.nNormals * 16, u16 = true;
for (const g of mP) {
  const pos = bits(g.attributes.position.array), w = g.attributes.aPack.array, ix = g.index.array;
  verts += g.attributes.position.count; bytesP += g.attributes.position.array.byteLength + w.byteLength + ix.byteLength; if (!(ix instanceof Uint16Array)) u16 = false;
  for (let k = 0; k < ix.length; k++, corner++) {
    const mv = ix[k], uv = U.index.array[corner];
    if (pos[mv * 3] !== upos[uv * 3] || pos[mv * 3 + 1] !== upos[uv * 3 + 1] || pos[mv * 3 + 2] !== upos[uv * 3 + 2]) { bad++; continue; }
    const lo = w[mv * 2], hi = w[mv * 2 + 1], tone = lo % TONES, rest = Math.floor(lo / TONES), nid = hi * NLOW + (rest >> 1), t = tone * 16;
    const dv = { aFacet: [rest & 1], normal: [T.normals[nid * 4], T.normals[nid * 4 + 1], T.normals[nid * 4 + 2]], cDay: [T.tones[t], T.tones[t + 1], T.tones[t + 2]], cGold: [T.tones[t + 4], T.tones[t + 5], T.tones[t + 6]], cNight: [T.tones[t + 8], T.tones[t + 9], T.tones[t + 10]], aSurface: [T.tones[t + 12], T.tones[t + 13], T.tones[t + 14], T.tones[t + 15]] };
    const f32 = new Float32Array(4), u32 = new Uint32Array(f32.buffer);
    for (const n in K) { f32.set(dv[n]); for (let c = 0; c < K[n]; c++) if (u32[c] !== ub[n][uv * K[n] + c]) { bad++; break; } }
  }
}
const V = ua.position.count, MiB = b => (b / 1048576).toFixed(1);
out(`${U.index.count / 3} triangles; unpacked ${MiB(bytesU)} MiB (${V} vertices); packed+merged ${mP.length} meshes, ${verts} vertices stored (${(100 * verts / V).toFixed(1)}%), 16-bit indices ${u16}, ${MiB(bytesP)} MiB incl. ${(T.nTones * 64 + T.nNormals * 16) / 1048576 | 0}.${Math.round(((T.nTones * 64 + T.nNormals * 16) / 1048576 % 1) * 10)} MiB of tables; build ${(ms / 1000).toFixed(1)} s`);
out(bad === 0 && corner === U.index.count ? 'PASS: every triangle decodes to the unpacked triangle, corner by corner' : `FAIL: ${bad} corner(s) differ (${corner} of ${U.index.count} corners walked)`);
process.exit(bad === 0 && corner === U.index.count ? 0 : 1);
