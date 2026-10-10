/**
 * packverts-decode.mjs — ?packverts=1 loses NOTHING: decode the packed vertices on the CPU and compare them, bit for bit, with the
 * unpacked ones the same builder makes for the same calls.
 *
 * NO BROWSER, NO GPU, no three.js: Node and the repo's own files, a few seconds. Runs in CI.
 *
 * WHAT IT HOLDS. The real js/slopes.js is loaded the way the page loads it (with ?packverts=1). The same builder calls (the Moontower's
 * 8,799 recorded calls, and a synthetic set with bent and degenerate quads, triN, facet runs and flipped windings) go through
 *   - build()                          the unpacked layout, 55.7 bytes a vertex, and
 *   - build(undefined, { pack })       the packed layout: position + one 32-bit word (the shader's tone table and normal table)
 * and then the packed vertex is decoded EXACTLY as VERT decodes it (the same arithmetic on the same float values: tone = lo mod 2^13,
 * facet bit, normal index = hi * 4 + ..., four texels a tone) and compared with the unpacked vertex: position bits, normal bits, the
 * three colour triples as float32(byte / 255), the surface quad bits, the facet flag, and the whole index. Zero differences is the pass.
 * What this cannot see is the GPU reading the textures: packverts-pixels.mjs renders both and compares the pictures.
 *
 *   node scripts/verify/packverts-decode.mjs            exit 0 = every vertex decodes to exactly what the unpacked layout holds
 *   node scripts/verify/packverts-decode.mjs --break    flips one bit in one table entry after the build: must report MISMATCH and exit 1
 *   node scripts/verify/packverts-decode.mjs --merge     the same for ?packmerge=1: the mesh is several meshes with 16-bit indices and identical vertices stored once; every
 *                                                        TRIANGLE, corner by corner, must decode to the unpacked triangle's vertices, in order
 */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RM = path.join(REPO, 'experiments/rust-mesh');
const BREAK = process.argv.includes('--break');
const { REC } = await import(pathToFileURL(path.join(RM, 'js/common.mjs')));
const { loadStream } = await import(pathToFileURL(path.join(RM, 'js/stream.mjs')));
const { installStubs } = await import(pathToFileURL(path.join(RM, 'profile/app-patch.mjs')));
const { THREE_STUB, toneObjects } = await import(pathToFileURL(path.join(RM, 'js/builder-app.mjs')));
const { synthetic } = await import(pathToFileURL(path.join(RM, 'js/synthetic.mjs')));

// the real js/slopes.js, as the page loads it, with the switch on
{
  const ctx = globalThis;
  ctx.window = ctx; ctx.self = ctx; ctx.location = { search: '?slopes=0&packverts=1' + (process.argv.includes('--merge') ? '&packmerge=1' : ''), href: 'http://x/' };
  ctx.document = { getElementById: () => null, hidden: false, readyState: 'complete', createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, body: {} };
  ctx.addEventListener = () => {}; ctx.devicePixelRatio = 1; ctx.LITE_PROFILE = undefined;
  if (!ctx.navigator) Object.defineProperty(ctx, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  installStubs(ctx); ctx.THREE = THREE_STUB;
  vm.runInThisContext(fs.readFileSync(path.join(REPO, 'js/slopes.js'), 'utf8'), { filename: path.join(REPO, 'js/slopes.js') });
}
const S = globalThis.slopes;
let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
say(S.packOn() === true && S.packTables() !== null, 'switch on: slopes.packTables() hands out tables');

function drive(B, stream, records, tones) {
  for (let i = 0, o = 0; i < records; i++, o += REC) {
    const op = stream[o];
    if (op === 3) { B.facet(stream[o + 27] !== 0); continue; }
    const col = tones[stream[o + 1]], P = k => [stream[o + k], stream[o + k + 1], stream[o + k + 2]];
    const want = stream[o + 2] ? P(3) : undefined;
    if (op === 0) B.tri(P(6), P(9), P(12), col, want);
    else if (op === 1) B.quad(P(6), P(9), P(12), P(15), col, want);
    else B.triN(P(6), P(9), P(12), P(18), P(21), P(24), col);
  }
  return B.geometry();
}

/** VERT's decode, in JS, on the float values the GPU would read from the two textures (float32 throughout) */
function decode(g, tables, wiredBits = S.packInfo().toneBits) {
  const f = Math.fround;
  const lo16 = g.attributes.aPack.array, V = lo16.length / 2, TONES = 2 ** wiredBits, NLOW = 2 ** (15 - wiredBits);
  const out = { normal: new Float32Array(V * 3), cDay: new Float32Array(V * 3), cGold: new Float32Array(V * 3), cNight: new Float32Array(V * 3), aFacet: new Float32Array(V), aSurface: new Float32Array(V * 4) };
  for (let v = 0; v < V; v++) {
    const lo = lo16[v * 2], hi = lo16[v * 2 + 1];
    const tone = lo % TONES, rest = Math.floor(lo / TONES);
    const facet = rest % 2, nid = hi * NLOW + Math.floor(rest * 0.5);
    out.aFacet[v] = facet;
    const t = tone * 16;
    for (let k = 0; k < 3; k++) { out.cDay[v * 3 + k] = tables.tones[t + k]; out.cGold[v * 3 + k] = tables.tones[t + 4 + k]; out.cNight[v * 3 + k] = tables.tones[t + 8 + k]; out.normal[v * 3 + k] = tables.normals[nid * 4 + k]; }
    for (let k = 0; k < 4; k++) out.aSurface[v * 4 + k] = tables.tones[t + 12 + k];
  }
  return out;
}
const bits = a => new Uint32Array(a.buffer, a.byteOffset, a.length);
const sameBits = (a, b) => { if (a.length !== b.length) return false; const x = bits(a), y = bits(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };

function checkMerged(name, stream, records, tones) {
  const tables = S.packTables();
  const U = drive(S.build(), stream, records, tones);
  const B = S.build(undefined, { pack: tables });
  drive({ ...B, geometry: () => null }, stream, records, tones);   // emit the calls; the merged meshes come from geometries()
  const geoms = B.geometries();
  if (BREAK) tables.normals[Math.floor(tables.nNormals / 2) * 4 + 1] += 1e-3;
  const ua = U.attributes, norm = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = Math.fround(a[i] / 255); return o; };
  const un = { normal: ua.normal.array, cDay: norm(ua.cDay.array), cGold: norm(ua.cGold.array), cNight: norm(ua.cNight.array), aFacet: Float32Array.from(ua.aFacet.array), aSurface: ua.aSurface.array };
  const dec = geoms.map(g => decode(g, tables)), K = { normal: 3, cDay: 3, cGold: 3, cNight: 3, aFacet: 1, aSurface: 4 };
  const upos = bits(ua.position.array); let t = 0, bad = 0, verts = 0, idxBytes = 0, vBytes = 0;
  for (let gi = 0; gi < geoms.length; gi++) {
    const g = geoms[gi], pos = bits(g.attributes.position.array), ix = g.index.array;
    verts += g.attributes.position.count; idxBytes += ix.byteLength; vBytes += g.attributes.position.array.byteLength + g.attributes.aPack.array.byteLength;
    if (!(ix instanceof Uint16Array)) bad++;
    for (let k = 0; k < ix.length; k++) {
      const corner = t * 3 + (k % 3), uv = U.index.array[corner], mv = ix[k];
      if (k % 3 === 2) t++;
      let ok = pos[mv * 3] === upos[uv * 3] && pos[mv * 3 + 1] === upos[uv * 3 + 1] && pos[mv * 3 + 2] === upos[uv * 3 + 2];
      for (const n in K) { const a = bits(dec[gi][n]), b = bits(un[n]); for (let c = 0; c < K[n]; c++) if (a[mv * K[n] + c] !== b[uv * K[n] + c]) ok = false; }
      if (!ok) bad++;
    }
  }
  const nT = U.index.array.length / 3, V = ua.position.count;
  const bytesU = Object.values(ua).reduce((s, a) => s + a.array.byteLength, 0) + U.index.array.byteLength, bytesP = vBytes + idxBytes + tables.nTones * 64 + tables.nNormals * 16;
  say(t === nT && bad === 0, `${name}: ${nT} triangles in ${geoms.length} mesh(es), ${verts} vertices stored (${V} unmerged, ${(100 * verts / V).toFixed(1)}%), ${bad} corner(s) differ; ${(bytesU / 1048576).toFixed(2)} MiB unpacked -> ${(bytesP / 1048576).toFixed(2)} MiB merged incl. tables`);
}
function check(name, stream, records, tones) {
  if (process.argv.includes('--merge')) return checkMerged(name, stream, records, tones);
  const tables = S.packTables();
  const U = drive(S.build(), stream, records, tones);
  const Pk = drive(S.build(undefined, { pack: tables }), stream, records, tones);
  if (BREAK) tables.normals[Math.floor(tables.nNormals / 2) * 4 + 1] += 1e-3;
  const V = U.attributes.position.count;
  const d = decode(Pk, tables);
  const ua = U.attributes;
  // the unpacked colours are normalised bytes: the shader sees float32(byte / 255)
  const norm = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = Math.fround(a[i] / 255); return o; };
  const checks = {
    position: sameBits(Pk.attributes.position.array, ua.position.array),
    normal: sameBits(d.normal, ua.normal.array),
    cDay: sameBits(d.cDay, norm(ua.cDay.array)), cGold: sameBits(d.cGold, norm(ua.cGold.array)), cNight: sameBits(d.cNight, norm(ua.cNight.array)),
    aFacet: sameBits(d.aFacet, Float32Array.from(ua.aFacet.array)),
    aSurface: sameBits(d.aSurface, ua.aSurface.array),
    index: sameBits(Pk.index.array, U.index.array),
  };
  const bad = Object.keys(checks).filter(k => !checks[k]);
  if (process.env.DEBUG && bad.includes('normal')) { const a = bits(d.normal), b = bits(ua.normal.array); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { console.log('first normal diff at', i, i / 3 | 0, [...d.normal.slice((i / 3 | 0) * 3, (i / 3 | 0) * 3 + 3)], [...ua.normal.array.slice((i / 3 | 0) * 3, (i / 3 | 0) * 3 + 3)]); break; } }
  const bytesU = Object.values(ua).reduce((s, a) => s + a.array.byteLength, 0) + U.index.array.byteLength;
  const bytesP = Object.values(Pk.attributes).reduce((s, a) => s + a.array.byteLength, 0) + Pk.index.array.byteLength + tables.nTones * 64 + tables.nNormals * 16;
  say(bad.length === 0, `${name}: ${V} vertices, ${tables.nTones} tones, ${tables.nNormals} normals: position, normal, three colours, surface, facet, index ${bad.length ? 'MISMATCH ' + bad : 'all identical'}   (${(bytesU / 1048576).toFixed(2)} MiB unpacked -> ${(bytesP / 1048576).toFixed(2)} MiB packed incl. tables, ${(100 * bytesP / bytesU).toFixed(0)}%)`);
}

const fx = loadStream(path.join(RM, 'fixtures/moontower'));
check('Moontower (the real generator\'s calls)', fx.stream, fx.records, toneObjects(fx.palette));
const syn = synthetic();
check('synthetic (bent and degenerate quads, triN, facet runs, flipped winding)', syn.stream, syn.records, toneObjects(syn.palette));

// the word itself: every field at its limits survives the round trip, and running out of either table is a packOverflow error, not wrong output
{
  const T = S.packTables(); let ok = true;
  const B = S.packInfo().toneBits, TONES = 2 ** B, NLOW = 2 ** (15 - B), NMAX = 2 ** (31 - B);
  for (const tone of [0, 1, TONES - 1]) for (const facet of [0, 1]) for (const nid of [0, 1, NLOW - 1, NLOW, 65535, 65536, NMAX - 1]) {
    const lo = T.wordLo(tone, facet, nid), hi = T.wordHi(nid);
    const t = lo % TONES, rest = Math.floor(lo / TONES), f = rest % 2, n = hi * NLOW + Math.floor(rest * 0.5);
    if (t !== tone || f !== facet || n !== nid || lo > 65535 || hi > 65535) ok = false;
  }
  say(ok, `the vertex word round-trips tone (${B} bits), facet (1) and normal index (${31 - B}) at their limits, both halves within 16 bits`);
  const U = S.packTables(); let thrown = null;
  try { for (let i = 0; i <= TONES; i++) U.tone(['#' + (i + 0x100000).toString(16), '#000000', '#000000']); } catch (e) { thrown = e; }
  say(!!(thrown && thrown.packOverflow), `more than ${TONES} distinct tones throws a packOverflow error (the apartments rebuild unpacked)`);
  const N = S.packTables(); thrown = null;
  try { for (let i = 0; i <= NMAX; i++) N.normal(i + 1, 0, 0); } catch (e) { thrown = e; }
  say(!!(thrown && thrown.packOverflow), `more than ${NMAX} distinct normals throws a packOverflow error`);
}
console.log(failed ? `\nFAIL: ${failed} check(s) failed${BREAK ? ' (--break: this is the expected result)' : ''}` : '\nPASS: packed vertices decode to exactly the unpacked ones');
process.exit(failed ? 1 : 0);
