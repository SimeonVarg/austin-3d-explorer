/**
 * rust-load-fallbacks.mjs — the phone defaults, and every way the Rust builder or the packed layout can fail to start, each ending in a page that still builds.
 *
 * NO BROWSER, NO GPU, no three.js: Node and the repo's own files. Runs in CI. It loads the REAL js/slopes.js (and js/slopes-rust.js, wasm/meshkernel.wasm) the way the
 * page does and breaks one thing at a time.
 *
 *   A. DEFAULTS   packed vertices are ON for every tier (js/slopes.js PACK_DEFAULT_ON), the Rust builder OFF everywhere (js/mobile.js LITE.budget.rustBuilder is false); ?rustbuilder=0|1 and ?packverts=0|1
 *                 override either way; where the builder is off the .wasm is NEVER fetched.
 *   B. LOADING    with ?rustbuilder=1 on a phone (the switch is the only way in now), with: a 404 for the .wasm; a network error / blocked fetch; bytes that are not WebAssembly; no WebAssembly at all (an old browser);
 *                 an instance that cannot be made (an out-of-memory RangeError). Each: the page keeps going (rustReady settles, never rejects), the builder is the JS one,
 *                 exactly ONE console line says so, and the buffers are the JS builder's bytes (packed and unpacked). And two that must still WORK because the loader has a
 *                 non-streaming path: a host that serves the .wasm as text/plain (compileStreaming refuses it) and a browser without compileStreaming.
 *   C. BYTE RULE  the packed tone table holds what the GPU makes of a normalised byte, measured by a probe (slopes.js byteFloats). A probe that cannot run, throws, links
 *                 nothing or reads back garbage falls back to the spec rule (byte / 255); a GPU that multiplies by 1/255 gets those values; one that is neither gets what it measured.
 *   --break  the JS builder's result after each fallback is nudged by 1 mm in the check's own input: every fallback case must then report a difference and the run exit 1.
 */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..'), RM = path.join(REPO, 'experiments/rust-mesh');
const BREAK = process.argv.includes('--break');
let failed = 0; const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex'), shaArr = a => sha(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const { REC } = await import(pathToFileURL(path.join(RM, 'js/common.mjs')));
const { loadStream } = await import(pathToFileURL(path.join(RM, 'js/stream.mjs')));
const { installStubs } = await import(pathToFileURL(path.join(RM, 'profile/app-patch.mjs')));
const { THREE_STUB, toneObjects } = await import(pathToFileURL(path.join(RM, 'js/builder-app.mjs')));
const fx = loadStream(path.join(RM, 'fixtures/moontower')), tones = toneObjects(fx.palette);
const wasmBytes = fs.readFileSync(path.join(REPO, 'wasm/meshkernel.wasm'));
const RealInstance = WebAssembly.Instance, RealCS = WebAssembly.compileStreaming, RealWA = globalThis.WebAssembly;

/** the Moontower's recorded calls through a builder; `nudge` moves one coordinate by 1 mm (the --break) */
function drive(B, nudge) {
  const S = fx.stream; let mid = Math.floor(fx.records / 2); while (S[mid * REC] === 3) mid++;
  for (let i = 0, o = 0; i < fx.records; i++, o += REC) {
    const op = S[o]; if (op === 3) { B.facet(S[o + 27] !== 0); continue; }
    const col = tones[S[o + 1]], P = k => [S[o + k], S[o + k + 1], S[o + k + 2]], a = P(6); if (nudge && i === mid) a[0] += 1e-3;
    const want = S[o + 2] ? P(3) : undefined;
    if (op === 0) B.tri(a, P(9), P(12), col, want); else if (op === 1) B.quad(a, P(9), P(12), P(15), col, want); else B.triN(a, P(9), P(12), P(18), P(21), P(24), col);
  }
  const g = B.geometry(), A = g.attributes, o = {};
  for (const k of Object.keys(A)) o[k] = shaArr(A[k].array);
  o.index = shaArr(g.index.array);
  if (g.userData.pack) { o.tones = shaArr(g.userData.pack.tones.subarray(0, g.userData.pack.nTones * 16)); o.normals = shaArr(g.userData.pack.normals.subarray(0, g.userData.pack.nNormals * 4)); }
  return o;
}
/** load js/slopes.js as the page does: `search` is the query string, `phone` the window.LITE_PROFILE, `net` the fetch, `canvas` document.createElement('canvas') */
async function load(search, { phone = false, net = null, canvas = null } = {}) {
  const ctx = globalThis, calls = [], warns = [];
  ctx.window = ctx; ctx.self = ctx; ctx.location = { search, href: 'http://x/' };
  ctx.document = { getElementById: () => null, hidden: false, readyState: 'complete', createElement: t => t === 'canvas' && canvas ? canvas() : ({ getContext: () => null, style: {} }), addEventListener() {}, body: {} };
  ctx.addEventListener = () => {}; ctx.devicePixelRatio = 1;
  ctx.LITE_PROFILE = phone ? { on: true, budget: { rustBuilder: false, freeGeometryCpu: true } } : undefined;
  if (!ctx.navigator) Object.defineProperty(ctx, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  installStubs(ctx); ctx.THREE = THREE_STUB;
  ctx.fetch = async url => { calls.push(String(url)); return net ? net(String(url)) : new Response(wasmBytes, { headers: { 'content-type': 'application/wasm' } }); };
  const origWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try { const file = path.join(REPO, 'js/slopes.js'); vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: pathToFileURL(file).href, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }); if (ctx.slopes.rustReady) await ctx.slopes.rustReady; }
  finally { console.warn = origWarn; }
  return { slopes: ctx.slopes, calls, warns };
}
const restore = () => { globalThis.WebAssembly = RealWA; WebAssembly.Instance = RealInstance; WebAssembly.compileStreaming = RealCS; };

// ── A. DEFAULTS ───────────────────────────────────────────────────────────
{
  const d = await load('?slopes=0');
  say(d.slopes.rustReady === null && d.slopes.rustBuilder === false && d.slopes.packOn() === true && d.calls.length === 0, 'desktop, no switch: packed vertices ON, the Rust builder OFF, NOTHING is fetched');
  const p = await load('?slopes=0', { phone: true });
  say(p.slopes.rustReady === null && p.slopes.rustBuilder === false && p.slopes.packOn() === true && p.calls.length === 0, 'phone profile, no switch: the same, packed ON, nothing fetched (no .wasm, no js/slopes-rust.js)');
  const d0 = await load('?slopes=0&packverts=0');
  say(d0.slopes.packOn() === false && d0.slopes.rustReady === null && d0.calls.length === 0, 'desktop + ?packverts=0: the old layout, nothing fetched (the page as it was)');
  const p0 = await load('?slopes=0&packverts=0', { phone: true });
  say(p0.slopes.packOn() === false && p0.calls.length === 0, 'phone + ?packverts=0: the old layout');
  const p1 = await load('?slopes=0&rustbuilder=1', { phone: true });
  say(p1.slopes.rustBuilder === true && p1.slopes.packOn() === true && p1.calls.join() === 'wasm/meshkernel.wasm', 'phone + ?rustbuilder=1: the Rust builder on too, exactly one fetch, wasm/meshkernel.wasm');
  const d1 = await load('?slopes=0&rustbuilder=1');
  say(d1.slopes.rustBuilder === true && d1.slopes.packOn() === true && d1.calls.join() === 'wasm/meshkernel.wasm', 'desktop + ?rustbuilder=1: the Rust builder on, exactly one fetch');
  const r0 = await load('?slopes=0&rustbuilder=0', { phone: true });
  say(r0.slopes.rustReady === null && r0.slopes.packOn() === true, '?rustbuilder=0: the same as the default');
}

// ── B. LOADING ────────────────────────────────────────────────────────────
const refUnpacked = drive((await load('?slopes=0&rustbuilder=0&packverts=0', { phone: true })).slopes.build(), false);
const RB = '?slopes=0&rustbuilder=1';
const refPackedL = await load('?slopes=0&rustbuilder=0&packverts=1', { phone: true });
const refPacked = drive(refPackedL.slopes.build(undefined, { wasm: true, pack: refPackedL.slopes.packTables() }), false);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cases = [
  ['the .wasm is a 404', { net: () => new Response('not found', { status: 404 }) }],
  ['the fetch fails (a blocked request, offline)', { net: () => { throw new TypeError('Failed to fetch'); } }],
  ['the bytes are not WebAssembly (a captive portal page)', { net: () => new Response(new TextEncoder().encode('<html>sign in</html>'), { headers: { 'content-type': 'application/wasm' } }) }],
  ['there is no WebAssembly at all (an old browser)', { noWA: true }],
];
for (const [name, opts] of cases) {
  try {
    if (opts.noWA) globalThis.WebAssembly = undefined;
    const l = await load(RB, { phone: true, ...opts });
    restore();
    const info = l.slopes.rustInfo();
    say(l.slopes.rustBuilder === false && info.state === 'failed', `${name}: rustReady settles, the Rust builder is off (state ${info.state})`);
    say(l.warns.length === 1 && /did not load/.test(l.warns[0]), `${name}: exactly one console line (${l.warns.length}): ${(l.warns[0] || '').slice(0, 90)}`);
    const un = drive(l.slopes.build(undefined, { wasm: true }), BREAK);
    say(same(un, refUnpacked), `${name}: the unpacked buffers are the JS builder's (position ${un.position.slice(0, 10)}...)`);
    const pk = drive(l.slopes.build(undefined, { wasm: true, pack: l.slopes.packTables() }), BREAK);
    say(same(pk, refPacked), `${name}: the packed buffers and tables are the JS packed store's`);
  } catch (e) { restore(); say(false, `${name}: threw ${e && e.message}`); }
}
{
  // the instance cannot be made (out of memory): the module compiled, the first build throws RangeError: the JS builder, now and from here on
  const l = await load(RB, { phone: true });
  const warns = []; const w0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  WebAssembly.Instance = function () { throw new RangeError('WebAssembly.Instance(): Out of memory: Cannot allocate Wasm memory for new instance'); };
  let un, pk; try { un = drive(l.slopes.build(undefined, { wasm: true }), BREAK); pk = drive(l.slopes.build(undefined, { wasm: true, pack: l.slopes.packTables() }), BREAK); } finally { WebAssembly.Instance = RealInstance; console.warn = w0; }
  say(same(un, refUnpacked) && same(pk, refPacked), 'the instance cannot be made (out of memory): the build is the JS builder\'s, unpacked and packed');
  say(l.slopes.rustBuilder === false && l.slopes.rustInfo().state === 'failed' && warns.length === 1, `and the Rust builder is off for good, with exactly one console line (${warns.length})`);
}
for (const [name, mod] of [['the host serves the .wasm as text/plain (compileStreaming refuses it)', { net: () => new Response(wasmBytes, { headers: { 'content-type': 'text/plain' } }) }], ['the browser has no compileStreaming', { noCS: true }]]) {
  if (mod.noCS) WebAssembly.compileStreaming = undefined;
  const l = await load(RB, { phone: true, ...mod }); restore();
  say(l.slopes.rustBuilder === true && l.warns.length === 0, `${name}: the non-streaming path still loads the module, no warning`);
  const un = drive(l.slopes.build(undefined, { wasm: true }), false);
  say(same(un, refUnpacked), `${name}: and the Rust buffers equal the JS builder's`);
}

// ── C. THE BYTE RULE ──────────────────────────────────────────────────────
const fakeGL = conv => () => ({ getContext: () => {
  const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, ARRAY_BUFFER: 4, TRANSFORM_FEEDBACK_BUFFER: 5, TRANSFORM_FEEDBACK: 6, STATIC_DRAW: 7, STATIC_READ: 8, UNSIGNED_BYTE: 9, INTERLEAVED_ATTRIBS: 10, RASTERIZER_DISCARD: 11, POINTS: 12,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, createProgram: () => ({}), attachShader() {}, transformFeedbackVaryings() {}, linkProgram() {}, getProgramParameter: () => true,
    createBuffer: () => ({}), createTransformFeedback: () => ({}), bindBuffer() {}, bufferData() {}, useProgram() {}, getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
    bindTransformFeedback() {}, bindBufferBase() {}, enable() {}, disable() {}, beginTransformFeedback() {}, drawArrays() {}, endTransformFeedback() {}, getError: () => 0, getExtension: () => null,
    getBufferSubData(t, off, out) { for (let c = 0; c < 256; c++) out[c * 4] = conv(c); } };
  return gl; } });
const f0 = Math.fround, inv0 = f0(1 / 255);
const cDiff = [...Array(256).keys()].find(c => f0(c / 255) !== f0(c * inv0));   // the first byte on which the two rules disagree
const hexDiff = '#' + cDiff.toString(16).padStart(2, '0').repeat(3);
const byte128 = async (canvas) => {
  const l = await load('?slopes=0&packverts=1', { canvas }); const T = l.slopes.packTables();
  T.tone([hexDiff, '#000000', '#ffffff']);   // day = the byte the rules disagree on, night = 255
  return { how: l.slopes.packInfo().byteConversion, day: T.tones[0], night: T.tones[8] };
};
{
  const f = Math.fround, inv = f(1 / 255), spec = f(cDiff / 255), rec = f(cDiff * inv);
  say(spec !== rec, `(the two rules really differ at byte ${cDiff}: ${spec} against ${rec})`);
  const bad = [
    ['no WebGL context', () => ({ getContext: () => null })],
    ['getContext throws', () => ({ getContext: () => { throw new Error('context creation failed'); } })],
    ['the program does not link', () => { const c = fakeGL(x => x / 255)(); const gl = c.getContext(); gl.getProgramParameter = () => false; return { getContext: () => gl }; }],
    ['the read-back throws', () => { const c = fakeGL(x => x / 255)(); const gl = c.getContext(); gl.getBufferSubData = () => { throw new Error('INVALID_OPERATION'); }; return { getContext: () => gl }; }],
    ['the read-back is garbage (all zeros)', fakeGL(() => 0)],
    ['a GL error is pending', () => { const gl = fakeGL(x => x * inv)().getContext(); gl.getError = () => 1282; return { getContext: () => gl }; }],
  ];
  for (const [name, canvas] of bad) { const r = await byte128(canvas); say(r.day === spec && r.how === 'untested', `byte rule probe: ${name}: the table keeps the spec rule (byte / 255) and says untested`); }
  const d = await byte128(fakeGL(x => f(x / 255))); say(d.how === 'divide' && d.day === spec, 'a GPU that divides: measured "divide", table = byte / 255');
  const r = await byte128(fakeGL(x => f(x * inv))); say(r.how === 'reciprocal' && r.day === rec, 'a GPU that multiplies by 1/255: measured "reciprocal", table = byte * (1/255)');
  const o = await byte128(fakeGL(x => f(f(x / 255) + (x === cDiff ? 1e-7 : 0)))); say(o.how === 'other' && o.day === f(f(cDiff / 255) + 1e-7), 'a GPU that is neither: measured "other", the table holds exactly what it measured');
}
console.log(failed ? `\nFAIL: ${failed} check(s) failed${BREAK ? ' (--break: this is the expected result)' : ''}` : '\nPASS: the defaults hold and every failure ends in a page that builds');
process.exit(failed ? 1 : 0);
