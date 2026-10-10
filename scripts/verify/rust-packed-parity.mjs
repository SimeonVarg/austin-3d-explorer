/**
 * rust-packed-parity.mjs — ?rustbuilder=1&packverts=1: the Rust vertex store's PACKED output must be bit-identical to the JS packed store's.
 *
 * NO BROWSER, NO GPU, no three.js: Node and the repo's own files (the real js/slopes.js, the real js/slopes-rust.js, the committed
 * wasm/meshkernel.wasm). Runs in CI like every top-level scripts/verify/*.mjs.
 *
 * WHAT IT HOLDS. The same builder calls go through
 *   - build(undefined, { pack })                  the JS packed store (js/slopes.js), and
 *   - build(undefined, { pack, wasm: true })      the Rust packed store (lib.rs init_packed, driven by js/slopes-rust.js)
 * each with its own fresh tables object, and the two must agree on EVERYTHING the page's material reads:
 *   position, aPack (the 32-bit vertex word) and the index, byte for byte; and the tone table, the normal table and the tone key
 *   order, id for id. The calls are: the Moontower's 8,799 recorded calls, the synthetic set (bent and degenerate quads, triN, facet runs,
 *   flipped winding), the polygon()/extrude() scenario of experiments/rust-mesh/compare.mjs, a tone/normal edge set (two objects with one
 *   key, same bytes in other text, an explicit zero surface, -0 against +0 in a normal, doubles that round to one float32), and the
 *   chunked builder (buildChunked: several modules sharing one pair of tables, each seeded from the one before) with a JS chunk mixed in.
 *   The tables are also checked at their limits: exactly 2^14 tones and exactly 2^17 normals build, one more of either is an error
 *   with packOverflow set (the apartment builder then rebuilds unpacked) and rustBuilderError NOT set (the Rust builder is not at fault).
 *   Last, the Rust packed vertices are decoded the way VERT decodes them and compared with the UNPACKED JS build of the same calls.
 *
 *   node scripts/verify/rust-packed-parity.mjs            exit 0 = identical
 *   node scripts/verify/rust-packed-parity.mjs --break    moves one coordinate of the Rust side's input by 1 mm: must report MISMATCH on the
 *                                                         POSITIONS and exit 1 (exit 3 if the break is too weak to show)
 */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RM = path.join(REPO, 'experiments/rust-mesh');
const BREAK = process.argv.includes('--break');
const { REC } = await import(pathToFileURL(path.join(RM, 'js/common.mjs')));
const { loadStream } = await import(pathToFileURL(path.join(RM, 'js/stream.mjs')));
const { installStubs } = await import(pathToFileURL(path.join(RM, 'profile/app-patch.mjs')));
const { THREE_STUB, toneObjects } = await import(pathToFileURL(path.join(RM, 'js/builder-app.mjs')));
const { synthetic } = await import(pathToFileURL(path.join(RM, 'js/synthetic.mjs')));

process.on('uncaughtException', e => { console.log('FAIL uncaught: ' + (e && e.stack || e)); process.exit(1); });
let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const shaText = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

// the real js/slopes.js, as the page loads it, with both switches on; the wasm comes from disk through a Response (compileStreaming wants application/wasm)
const ctx = globalThis;
ctx.window = ctx; ctx.self = ctx; ctx.location = { search: '?slopes=0&packverts=1&rustbuilder=1', href: 'http://x/' };
ctx.document = { getElementById: () => null, hidden: false, readyState: 'complete', createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, body: {} };
ctx.addEventListener = () => {}; ctx.devicePixelRatio = 1; ctx.LITE_PROFILE = undefined;
if (!ctx.navigator) Object.defineProperty(ctx, 'navigator', { value: { userAgent: 'node' }, configurable: true });
installStubs(ctx); ctx.THREE = THREE_STUB;
ctx.fetch = async url => new Response(fs.readFileSync(path.join(REPO, String(url))), { headers: { 'content-type': 'application/wasm' } });
async function loadSlopes() {
  const file = path.join(REPO, 'js/slopes.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: pathToFileURL(file).href, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  const s = globalThis.slopes; await s.rustReady; return s;
}
const S = await loadSlopes();
say(S.rustBuilder === true && S.packOn() === true && S.rustInfo().state === 'ready', 'both switches on: the Rust builder loaded and slopes.packOn() is true');

// ── one scenario through both stores ──────────────────────────────────────────────────────────
/** the geometry's arrays and the tables, as comparable digests */
function digest(geoms, T) {
  const out = { geoms: geoms.map(g => ({ position: sha(g.attributes.position.array), aPack: sha(g.attributes.aPack.array), index: sha(g.index.array), names: Object.keys(g.attributes).join(',') })) };
  out.nTones = T.nTones; out.nNormals = T.nNormals;
  out.tones = sha(T.tones.subarray(0, T.nTones * 16)); out.normals = sha(T.normals.subarray(0, T.nNormals * 4));
  out.keys = shaText([...T.toneOf.entries()].map(([k, v]) => v + '=' + k).join('\n'));
  return out;
}
const sameDigest = (a, b) => {
  const bad = [];
  if (a.geoms.length !== b.geoms.length) bad.push('geometries ' + a.geoms.length + ' vs ' + b.geoms.length);
  else a.geoms.forEach((g, i) => { for (const k of ['position', 'aPack', 'index', 'names']) if (g[k] !== b.geoms[i][k]) bad.push((a.geoms.length > 1 ? 'chunk' + i + ' ' : '') + k); });
  for (const k of ['nTones', 'nNormals', 'tones', 'normals', 'keys']) if (a[k] !== b[k]) bad.push(k);
  return bad;
};
/** run `drive(makeBuilder)` once per store. `makeBuilder(opts)` makes a plain or chunked builder; `finish(B)` returns the geometries. */
function bothStores(drive, { rustEdit } = {}) {
  const built = {};
  for (const store of ['js', 'rust']) {
    const T = S.packTables();
    const before = S.rustInfo().builds;
    const opts = store === 'rust' ? { pack: T, wasm: true } : { pack: T };
    const geoms = drive(opts, store === 'rust' ? rustEdit : undefined);
    built[store] = { d: digest(geoms, T), T, rustBuilds: S.rustInfo().builds - before, geoms };
  }
  return built;
}
function expectSame(name, r, extra = '') {
  const bad = sameDigest(r.js.d, r.rust.d);
  const g = r.js.d;
  say(bad.length === 0 && r.rust.rustBuilds >= 1 && r.js.rustBuilds === 0,
    `${name}: ${g.geoms.length} geometr${g.geoms.length === 1 ? 'y' : 'ies'}, ${g.nTones} tones, ${g.nNormals} normals: position, aPack, index, tone table, normal table, tone keys ${bad.length ? 'MISMATCH ' + bad : 'identical'}${extra}`);
  return bad;
}

// ── drivers ─────────────────────────────────────────────────────────────────────────────────────
function driveStream(B, stream, records, tones, { from = 0, to = records, nudge = false } = {}) {
  let mid = Math.floor(records / 2); while (stream[mid * REC] === 3) mid++;
  for (let i = from, o = from * REC; i < to; i++, o += REC) {
    const op = stream[o];
    if (op === 3) { B.facet(stream[o + 27] !== 0); continue; }
    const col = tones[stream[o + 1]], P = k => [stream[o + k], stream[o + k + 1], stream[o + k + 2]];
    const a = P(6); if (nudge && i === mid) a[0] += 1e-3;
    const want = stream[o + 2] ? P(3) : undefined;
    if (op === 0) B.tri(a, P(9), P(12), col, want);
    else if (op === 1) B.quad(a, P(9), P(12), P(15), col, want);
    else B.triN(a, P(9), P(12), P(18), P(21), P(24), col);
  }
}
const plain = (fn) => (opts, edit) => { const B = S.build(undefined, opts); fn(B, edit); return [B.geometry()]; };

const fx = loadStream(path.join(RM, 'fixtures/moontower'));
const moonTones = toneObjects(fx.palette);
const syn = synthetic(), synTones = toneObjects(syn.palette);

// ── 1. the recorded streams ───────────────────────────────────────────────────────────────────
{
  const r = bothStores(plain((B, edit) => driveStream(B, fx.stream, fx.records, moonTones, { nudge: !!edit })), { rustEdit: BREAK });
  const bad = expectSame('Moontower (the real generator\'s 8,799 calls)', r);
  if (BREAK) {
    if (!bad.includes('position')) { console.log('\nWEAK BREAK: the planted nudge did not change the position array (differing: ' + (bad.join(',') || 'none') + '); the gate cannot be trusted'); process.exit(3); }
    console.log('(--break) the planted nudge shows in: ' + bad.join(','));
  }
  // and the Rust build really is the Rust build: its arrays are views of Wasm memory, not copies
  const pos = r.rust.geoms[0].attributes.position.array, aw = r.rust.geoms[0].attributes.aPack.array;
  say(pos.buffer.constructor.name === 'ArrayBuffer' && pos.buffer.byteLength > pos.byteLength && aw.buffer === pos.buffer && aw instanceof Uint16Array,
    'the Rust build\'s position and aPack are views of one Wasm memory (aPack is a Uint16Array), the JS build\'s are trimmed copies');
  say(r.rust.geoms[0].userData.pack === r.rust.T && r.js.geoms[0].userData.pack === r.js.T, 'geometry.userData.pack is the caller\'s tables object on both stores');
}
{
  const r = bothStores(plain(B => driveStream(B, syn.stream, syn.records, synTones)));
  expectSame('synthetic set (bent and degenerate quads, triN, facet runs, flipped winding)', r);
}

// ── 2. polygon() and extrude() over the store (walls, caps, smooth curved sides), as compare.mjs does ──────────────────
{
  const col = syn.palette.slice(0, 3).map(p => { const c = p.hex.slice(); if (p.surface) c.surface = p.surface; return c; });
  const frame = { N: [0.6, 0.8, 0], T: [-0.8, 0.6, 0], at: (u, v, z) => [10 + u * -0.8 + v * 0.6, 20 + u * 0.6 + v * 0.8, z || 0] };
  const shapes = B => {
    for (let i = 0; i < 400; i++) {
      const w = 1 + (i % 7) * 0.3, h = 2 + (i % 5) * 0.4, c = col[i % 3];
      B.extrude([[0, 0], [w, 0], [w, h], [0, h]], frame, 0, 0.2 + (i % 3) * 0.1, c, i % 4 === 0 ? { sides: false } : {});
      B.extrude([[0, 0], [w, 0], [w * 1.1, h * 0.6], [w * 0.5, h], [-w * 0.1, h * 0.6]], frame, -0.1, 0.3, c, { smooth: true });
      B.polygon([[0, 0, 0, 0], [3, 0, 0, 3], [3, 0, 2, 3], [0, 0, 2.5, 0]], c, [0, -1, 0], 'uz');
      B.polygon([[0, 0, 5], [4, 0, 5], [4, 3, 5.2], [1, 4, 5]], c, [0, 0, 1], 'xy');
    }
  };
  const r = bothStores(plain(shapes));
  expectSame('extrude/polygon scenario (smooth sides, flipped caps)', r);
}

// ── 3. the tone/normal edge set ─────────────────────────────────────────────────────────────────────
// What the JS store does with these is the reference. Each line is a trap for a store that interns by VALUE or by identity.
function edgeCalls(B) {
  const mk = (hex, surface) => { const c = hex.slice(); if (surface) c.surface = surface; return c; };
  const H = ['#aabbcc', '#112233', '#445566'];
  const pool = [
    mk(H), mk(H),                                              // two objects, one key: ONE tone
    mk(['#AABBCC', '#112233', '#445566']),                     // the same bytes in other text: the JS store makes a SECOND tone
    mk(H, [0, 0, 0, 0]),                                       // an explicit zero surface: another key, the same row
    mk(H, [-0, 1, 0.5, 0.25]), mk(H, [0, 1, 0.5, 0.25]),       // -0 and +0 print the same: one key, the first object's row
    mk(H, [0.1 + 0.2, 1, 0.5, 0.25]), mk(H, [0.3, 1, 0.5, 0.25]),   // two doubles with one float32: two keys, two ids, equal rows
    mk(['#000000', '#ffffff', '#7f7f7f'], [4, 0.25, 0.5, 0.75]), mk(['#ff0000', '#00ff00', '#0000ff']),
  ];
  const A = [0, 0, 0], Bp = [2, 0, 0], C = [0, 2, 0], D = [2, 2, 0];
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const normals = [[0, 0, 1], [-0, 0, 1], [0, -0, 1], [0, 0, -1], [-0, -0, -1], [1, 0, 0], [0.6, 0, 0.8], [0.1 + 0.2, 0, 0.9], [0.3, 0, 0.9]];
  for (let i = 0; i < 2500; i++) {
    const col = pool[Math.floor(rnd() * pool.length)];
    if (i % 53 === 0) B.facet(rnd() < 0.5);
    const k = rnd();
    if (k < 0.3) B.quad(A, Bp, D, C, col, rnd() < 0.5 ? [0, 0, rnd() < 0.5 ? 1 : -1] : undefined);
    else if (k < 0.5) B.tri(A, Bp, C, col, rnd() < 0.5 ? [0, 0, -1] : undefined);
    else B.triN(A, Bp, C, normals[Math.floor(rnd() * normals.length)], normals[Math.floor(rnd() * normals.length)], normals[Math.floor(rnd() * normals.length)], col);
  }
}
{
  const r = bothStores(plain(B => edgeCalls(B)));
  expectSame('tone/normal edge set (one key two objects, same bytes other text, -0 against +0, doubles that round alike)', r);
  // the cases must really have made distinct entries, or the set proves nothing
  say(r.js.d.nTones >= 8 && r.js.d.nNormals >= 8, `the edge set makes ${r.js.d.nTones} tones and ${r.js.d.nNormals} normals (so the traps are live)`);
}

// ── 4. the chunked builder: several modules, one pair of tables ───────────────────────────────────
{
  const run = (maxTris) => bothStores((opts) => {
    const B = S.buildChunked(maxTris, false, opts);
    driveStream(B, fx.stream, fx.records, moonTones);
    return B.geometries();
  });
  for (const maxTris of [700, 3000]) {
    const r = run(maxTris);
    expectSame(`buildChunked(${maxTris} triangles) over the Moontower`, r, `, ${r.rust.rustBuilds} Rust modules`);
  }
  const r2 = bothStores((opts) => { const B = S.buildChunked(900, false, opts); driveStream(B, syn.stream, syn.records, synTones); return B.geometries(); });
  expectSame('buildChunked(900 triangles) over the synthetic set', r2, `, ${r2.rust.rustBuilds} Rust modules`);
  // a Rust chunk, then a JS chunk, then a Rust chunk on ONE pair of tables: the same bytes as three JS chunks
  const mixed = (modes) => {
    const T = S.packTables(), geoms = [], third = Math.floor(syn.records / 3);
    modes.forEach((m, i) => {
      const B = S.build(undefined, m === 'rust' ? { pack: T, wasm: true } : { pack: T });
      driveStream(B, syn.stream, syn.records, synTones, { from: i * third, to: i === modes.length - 1 ? syn.records : (i + 1) * third });
      geoms.push(B.geometry());
    });
    return { d: digest(geoms, T), rustBuilds: 0 };
  };
  const a = mixed(['js', 'js', 'js']), b = mixed(['rust', 'js', 'rust']), c = mixed(['js', 'rust', 'js']);
  const bad = [...sameDigest(a.d, b.d), ...sameDigest(a.d, c.d)];
  say(bad.length === 0, `Rust, JS and Rust chunks on one pair of tables (and JS, Rust, JS) equal three JS chunks: ${bad.length ? 'MISMATCH ' + bad : 'identical'}`);
}

// ── 5. the limits ─────────────────────────────────────────────────────────────────────────────────────
{
  const B14 = S.packInfo().toneBits, TONES = 2 ** B14, NMAX = 2 ** (31 - B14);
  const hex = i => '#' + (i + 0x100000).toString(16).padStart(6, '0');
  const tris = (count) => (B) => { for (let i = 0; i < count; i++) B.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], [hex(i), '#000000', '#000000']); };
  const normalsUpTo = (count) => (B) => {   // `count` distinct normals; the triangle is fixed, each corner brings its own
    const col = ['#101010', '#202020', '#303030'], a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0];
    let made = 0;
    while (count - made >= 3) { B.triN(a, b, c, [made + 1, 0, 0], [made + 2, 0, 0], [made + 3, 0, 0], col); made += 3; }
    if (count - made >= 1) { B.tri(a, b, c, col); made++; }                      // normal (0, 0, 1)
    if (count - made >= 1) { B.tri(a, c, b, col); made++; }                      // normal (0, 0, -1)
  };
  const trial = (fn, store) => {
    const T = S.packTables(), opts = store === 'rust' ? { pack: T, wasm: true } : { pack: T };
    try { const B = S.build(undefined, opts); fn(B); return { g: [B.geometry()], T, err: null }; } catch (e) { return { g: null, T, err: e }; }
  };
  const atLimit = (name, fn, what) => {
    const j = trial(fn, 'js'), r = trial(fn, 'rust');
    const ok = !j.err && !r.err && sameDigest(digest(j.g, j.T), digest(r.g, r.T)).length === 0;
    say(ok, `exactly ${what}: both stores build it and agree${ok ? '' : '  (js: ' + (j.err && j.err.message) + '; rust: ' + (r.err && r.err.message) + ')'}`);
  };
  const overLimit = (fn, what) => {
    const j = trial(fn, 'js'), r = trial(fn, 'rust');
    say(!!(j.err && j.err.packOverflow) && !!(r.err && r.err.packOverflow) && !r.err.rustBuilderError && r.err.message === j.err.message,
      `${what}: both stores throw the packOverflow error (same message), the Rust one without rustBuilderError${r.err ? '' : '  (the Rust store did not throw!)'}`);
  };
  atLimit('tones', tris(TONES), `${TONES} tones`);
  overLimit(tris(TONES + 1), `${TONES + 1} tones`);
  atLimit('normals', normalsUpTo(NMAX), `${NMAX} normals`);
  overLimit(normalsUpTo(NMAX + 1), `${NMAX + 1} normals`);
  say(S.rustBuilder === true && S.rustInfo().state === 'ready', 'an overflow is the data\'s fault: the Rust builder is still on afterwards');
}

// ── 6. decoded the way VERT decodes it, the Rust packed vertices equal the UNPACKED build of the same calls ───────────────
{
  const f = Math.fround, bits = a => new Uint32Array(a.buffer, a.byteOffset, a.length);
  const same = (a, b) => { if (a.length !== b.length) return false; const x = bits(a), y = bits(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
  const norm = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = f(a[i] / 255); return o; };
  for (const [name, stream, records, tones] of [['Moontower', fx.stream, fx.records, moonTones], ['synthetic', syn.stream, syn.records, synTones]]) {
    const U = (() => { const B = S.build(); driveStream(B, stream, records, tones); return B.geometry(); })();
    const T = S.packTables(), P = (() => { const B = S.build(undefined, { pack: T, wasm: true }); driveStream(B, stream, records, tones); return B.geometry(); })();
    const w = P.attributes.aPack.array, V = w.length / 2, TONES = 2 ** S.packInfo().toneBits, NLOW = 2 ** (15 - S.packInfo().toneBits);
    const d = { normal: new Float32Array(V * 3), cDay: new Float32Array(V * 3), cGold: new Float32Array(V * 3), cNight: new Float32Array(V * 3), aFacet: new Float32Array(V), aSurface: new Float32Array(V * 4) };
    for (let v = 0; v < V; v++) {
      const lo = w[v * 2], hi = w[v * 2 + 1], tone = lo % TONES, rest = Math.floor(lo / TONES), nid = hi * NLOW + Math.floor(rest * 0.5), t = tone * 16;
      d.aFacet[v] = rest % 2;
      for (let k = 0; k < 3; k++) { d.cDay[v * 3 + k] = T.tones[t + k]; d.cGold[v * 3 + k] = T.tones[t + 4 + k]; d.cNight[v * 3 + k] = T.tones[t + 8 + k]; d.normal[v * 3 + k] = T.normals[nid * 4 + k]; }
      for (let k = 0; k < 4; k++) d.aSurface[v * 4 + k] = T.tones[t + 12 + k];
    }
    const ua = U.attributes;
    const ok = { position: same(P.attributes.position.array, ua.position.array), normal: same(d.normal, ua.normal.array), cDay: same(d.cDay, norm(ua.cDay.array)), cGold: same(d.cGold, norm(ua.cGold.array)),
      cNight: same(d.cNight, norm(ua.cNight.array)), aFacet: same(d.aFacet, Float32Array.from(ua.aFacet.array)), aSurface: same(d.aSurface, ua.aSurface.array), index: same(P.index.array, U.index.array) };
    const bad = Object.keys(ok).filter(k => !ok[k]);
    say(bad.length === 0, `${name}: the Rust packed vertices (${V}), decoded as VERT decodes them, equal the unpacked build: ${bad.length ? 'MISMATCH ' + bad : 'position, normal, three colours, surface, facet, index identical'}`);
  }
}

// ── 7. the Rust packed builder breaks after it loaded: the build is redone in JS, on tables that stay consistent ─────────────────────────
// (each case loads a fresh js/slopes.js: the fallback switches the Rust builder off for good)
{
  const RealInstance = WebAssembly.Instance;
  /** the Nth Rust module instance (1-based) misbehaves: 'trap' = process() throws a RuntimeError, 'init' = init_packed() throws (out of memory) */
  const inject = (nth, mode) => {
    let k = 0;
    WebAssembly.Instance = class extends RealInstance {
      constructor(mod, imp) {
        super(mod, imp);
        if (++k !== nth) return;
        const w = { ...this.exports };
        if (mode === 'trap') w.process = () => { throw new WebAssembly.RuntimeError('unreachable'); };
        else w.init_packed = () => { throw new RangeError('WebAssembly.Memory(): could not allocate memory'); };
        Object.defineProperty(this, 'exports', { value: w });
      }
    };
  };
  const heal = () => { WebAssembly.Instance = RealInstance; };
  const chunks = (Sx, opts, T) => { const B = Sx.buildChunked(900, false, { ...opts, pack: T }); driveStream(B, syn.stream, syn.records, synTones); return B.geometries(); };
  const ref = await loadSlopes();
  const refT = ref.packTables(), refG = chunks(ref, {}, refT), refD = digest(refG, refT);

  // a. module 3 of a chunked build traps in process(): withRustFallback throws the half-built result away and rebuilds all of it in JS
  {
    const Sx = await loadSlopes(); inject(3, 'trap');
    let T = null; const out = await Sx.withRustFallback(async opts => { T = Sx.packTables(); return chunks(Sx, opts, T); });
    heal();
    const bad = sameDigest(refD, digest(out, T));
    say(bad.length === 0 && Sx.rustBuilder === false && Sx.rustInfo().state === 'failed', `module 3 of a chunked packed build traps: the whole build is redone in JS, equal to the JS build (${bad.length ? 'MISMATCH ' + bad : 'identical'}), the Rust builder is off (${Sx.rustInfo().state})`);
  }
  // b. module 3 will not even start (init_packed throws): build() takes that chunk in JS on the SAME tables the two Rust chunks filled
  {
    const Sx = await loadSlopes(); inject(3, 'init');
    const T = Sx.packTables(), out = chunks(Sx, { wasm: true }, T);
    heal();
    const bad = sameDigest(refD, digest(out, T));
    say(bad.length === 0 && Sx.rustBuilder === false, `module 3 cannot start: chunks 1 and 2 Rust, the rest JS, on one pair of tables, equal to the all-JS build (${bad.length ? 'MISMATCH ' + bad : 'identical'})`);
  }
}

console.log(failed ? `\nFAIL: ${failed} check(s) failed${BREAK ? ' (--break: this is the expected result)' : ''}` : '\nPASS: the Rust packed store is bit-identical to the JS packed store');
process.exit(failed ? 1 : 0);
