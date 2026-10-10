/**
 * wasm-mesh-parity.mjs — the Rust vertex store (?rustbuilder=1) must make EXACTLY the buffers the JS builder makes.
 *
 * NO BROWSER, NO GPU, NO SERVER, no three.js: Node and the repo's own files. About two seconds. It runs in CI like every
 * top-level scripts/verify/*.mjs.
 *
 * WHAT IT HOLDS
 *   1. THE BINARY. wasm/meshkernel.wasm (what the page fetches) is byte-for-byte experiments/rust-mesh/dist/meshkernel.wasm
 *      and matches the sha256 recorded next to it. (./build.sh --check in experiments/rust-mesh rebuilds it from the Rust
 *      source and compares; that needs the Rust toolchain, so it is not a CI step.)
 *   2. THE BUILDERS. experiments/rust-mesh/compare.mjs feeds the same recorded calls (the Moontower, 8,799 calls, with the
 *      sha256 of what the real in-app build produced) plus a synthetic set (bent and degenerate quads, triN, facet runs,
 *      flipped winding, polygon() and extrude() with smooth sides) to js/slopes.js's own build(), a tuned JS twin, the raw
 *      Rust module, and js/slopes-rust.js (the page's adapter). All eight arrays, sha256, must be identical.
 *   3. THE WIRING IN THE PAGE'S OWN FILE. The real js/slopes.js is loaded twice into this process with stubs for the page:
 *        a. without the switch: slopes.rustReady is null, nothing is fetched or imported, build(.., {wasm:true}) is the JS builder;
 *        b. with ?rustbuilder=1: slopes.rustReady loads js/slopes-rust.js and wasm/meshkernel.wasm through the real loader
 *           block, and build(.., {wasm:true}) then returns the Rust builder, whose buffers equal the JS builder's.
 *
 *   4. THE FALLBACK. A Rust builder that breaks AFTER it loaded (a trap on the 8,192nd call, a throwing import, an instance that will
 *      not start) must not leave buildings missing or keep using the broken instance. Real js/slopes.js + real js/slopes-rust.js + the
 *      real module, with the module made to trap (WebAssembly.Instance wrapped so process() is handed a colour id far past the palette: a
 *      genuine out-of-bounds panic, hence an `unreachable` trap, in the real code) on the first builder only. A model of the apartment generator's loop (the same shape as
 *      js/slopes-apartments.js buildOnce: one builder, per-building try/catch that lets a Rust error out and swallows a recipe error)
 *      runs under slopes.withRustFallback(). The result must be the JS builder's, to the byte; the Rust builder must be switched off for
 *      every later build; a recipe error must NOT switch it off. The apartment file itself is held to the same shape by source checks.
 *
 *   node scripts/verify/wasm-mesh-parity.mjs            exit 0 = identical
 *   node scripts/verify/wasm-mesh-parity.mjs --break    moves one coordinate of the Rust builder's input only, by 1 mm: it must report MISMATCH on the
 *                                                       POSITIONS (not only the normals) and exit 1; exit 3 if the break is too weak to show in positions
 */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RM = path.join(REPO, 'experiments/rust-mesh');
const BREAK = process.argv.includes('--break');
let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const shaArr = a => sha(Buffer.from(a.buffer, a.byteOffset, a.byteLength));

// ── 1. the binary ─────────────────────────────────────────────────────────
const siteWasm = fs.readFileSync(path.join(REPO, 'wasm/meshkernel.wasm'));
const distWasm = fs.readFileSync(path.join(RM, 'dist/meshkernel.wasm'));
const recorded = fs.readFileSync(path.join(RM, 'dist/meshkernel.wasm.sha256'), 'utf8').split(/\s+/)[0];
say(Buffer.compare(siteWasm, distWasm) === 0, `wasm/meshkernel.wasm is the same bytes as experiments/rust-mesh/dist/meshkernel.wasm (${siteWasm.length} bytes)`);
say(sha(siteWasm) === recorded, `its sha256 is the recorded one (${recorded.slice(0, 12)}...)`);

// ── 2. the builders, by the study's compare harness (a child process: it owns its own exit code) ────
{
  const r = spawnSync(process.execPath, [path.join(RM, 'compare.mjs'), path.join(RM, 'fixtures/moontower'), ...(BREAK ? ['--break-rust'] : [])],
    { env: { ...process.env, WASM: path.join(REPO, 'wasm/meshkernel.wasm') }, encoding: 'utf8' });
  process.stdout.write(r.stdout.split('\n').map(l => '     ' + l).join('\n') + '\n');
  if (r.stderr) process.stderr.write(r.stderr);
  say(r.status === 0, 'compare.mjs: JS builder, tuned JS, Rust module and the page adapter produce identical buffers');
}

// ── 3. the wiring in the real js/slopes.js ────────────────────────────────
const { REC, hexBytes } = await import(pathToFileURL(path.join(RM, 'js/common.mjs')));
const { loadStream } = await import(pathToFileURL(path.join(RM, 'js/stream.mjs')));
const { installStubs } = await import(pathToFileURL(path.join(RM, 'profile/app-patch.mjs')));
const { THREE_STUB, toneObjects } = await import(pathToFileURL(path.join(RM, 'js/builder-app.mjs')));
const fx = loadStream(path.join(RM, 'fixtures/moontower'));
const tones = toneObjects(fx.palette);

const BREAK_NUDGE_M = 1e-3;   // the planted break: 1 mm, big enough to change a float32 POSITION (1e-9 only ever showed in the normals)
/** the Moontower's recorded calls [from, to) through any builder with the slopes.js API */
function driveRange(B, from, to, { nudge = false } = {}) {
  const S = fx.stream;
  let mid = Math.floor(fx.records / 2); while (S[mid * REC] === 3) mid++;   // a facet marker has no coordinates to move
  for (let i = from, o = from * REC; i < to; i++, o += REC) {
    const op = S[o];
    if (op === 3) { B.facet(S[o + 27] !== 0); continue; }
    const col = tones[S[o + 1]], P = k => [S[o + k], S[o + k + 1], S[o + k + 2]];
    const a = P(6); if (nudge && i === mid) a[0] += BREAK_NUDGE_M;
    const want = S[o + 2] ? P(3) : undefined;
    if (op === 0) B.tri(a, P(9), P(12), col, want);
    else if (op === 1) B.quad(a, P(9), P(12), P(15), col, want);
    else B.triN(a, P(9), P(12), P(18), P(21), P(24), col);
  }
}
/** the whole stream, then the eight arrays' sha256 */
function drive(B, opts) {
  driveRange(B, 0, fx.records, opts);
  return hashes(B);
}
function hashes(B) {
  const g = B.geometry(), A = g.attributes;
  return { position: shaArr(A.position.array), normal: shaArr(A.normal.array), cDay: shaArr(A.cDay.array), cGold: shaArr(A.cGold.array), cNight: shaArr(A.cNight.array),
    aFacet: shaArr(A.aFacet.array), aSurface: shaArr(A.aSurface.array), index: shaArr(g.index.array), triangles: B.triangles };
}

/** load the real js/slopes.js into THIS process the way the page does, with `search` as the query string; returns window.slopes + a log of fetch/import use */
async function loadSlopes(search) {
  const ctx = globalThis, calls = { fetch: [] };
  ctx.window = ctx; ctx.self = ctx; ctx.location = { search, href: 'http://x/' };
  ctx.document = { getElementById: () => null, hidden: false, readyState: 'complete', createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, body: {} };
  ctx.addEventListener = () => {}; ctx.devicePixelRatio = 1; ctx.LITE_PROFILE = undefined;
  if (!ctx.navigator) Object.defineProperty(ctx, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  installStubs(ctx);
  ctx.THREE = THREE_STUB;
  // the page fetches wasm/meshkernel.wasm; here the same bytes come from disk (and a Response, so compileStreaming sees application/wasm)
  ctx.fetch = async url => { calls.fetch.push(String(url)); return new Response(fs.readFileSync(path.join(REPO, String(url))), { headers: { 'content-type': 'application/wasm' } }); };
  const file = path.join(REPO, 'js/slopes.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: pathToFileURL(file).href, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  return { slopes: ctx.slopes, calls };
}

{
  // a. switch OFF: nothing new
  const off = await loadSlopes('?slopes=0');
  say(off.slopes.rustReady === null && off.slopes.rustBuilder === false && off.slopes.rustInfo().state === 'off', 'switch off: slopes.rustReady is null and the builder is not loaded');
  say(off.calls.fetch.length === 0, 'switch off: nothing is fetched');
  const jsOff = drive(off.slopes.build(undefined, { wasm: true }));
  // b. switch ON
  const on = await loadSlopes('?slopes=0&rustbuilder=1');
  say(!!on.slopes.rustReady && typeof on.slopes.rustReady.then === 'function', 'switch on: slopes.rustReady is a promise');
  await on.slopes.rustReady;
  say(on.slopes.rustBuilder === true && on.slopes.rustInfo().state === 'ready', `switch on: the module loaded through the page's own loader (compile ${on.slopes.rustInfo().compileMs} ms)`);
  say(on.calls.fetch.length === 1 && on.calls.fetch[0] === 'wasm/meshkernel.wasm', `switch on: exactly one fetch, ${on.calls.fetch.join(',')}`);
  const rust = on.slopes.build(undefined, { wasm: true });
  const rustOut = drive(rust, { nudge: BREAK });
  say(on.slopes.rustInfo().builds === 1, 'switch on: build(.., {wasm:true}) made one Rust builder');
  const jsNoOptIn = on.slopes.build();   // a generator that did not opt in keeps the JS builder even with the switch on
  const stillJs = drive(jsNoOptIn);
  const names = ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aFacet', 'aSurface', 'index'];
  const diffR = names.filter(n => rustOut[n] !== jsOff[n]), diffJ = names.filter(n => stillJs[n] !== jsOff[n]);
  say(diffR.length === 0 && rustOut.triangles === jsOff.triangles, `real slopes.js, switch on vs off: ${rustOut.triangles} triangles, all eight arrays ${diffR.length ? 'MISMATCH ' + diffR : 'identical'}`);
  say(diffJ.length === 0, 'a generator that does not opt in still gets the JS builder, unchanged');
  const exp = fx.expected.meshes[0].sha;
  say(names.every(n => rustOut[n] === exp[n]), 'and they equal the sha256 of what the real in-app build produced (recorded in expected.json)');
  if (BREAK) {
    // the planted break must be visible in the POSITIONS, the array a real regression in the vertex store would corrupt first
    if (!diffR.includes('position')) { console.log('\nWEAK BREAK: the planted nudge did not change the position array (differing: ' + (diffR.join(',') || 'none') + '); the gate cannot be trusted'); process.exit(3); }
    console.log('(--break) the planted nudge shows in: ' + diffR.join(','));
  }
}

// ── 4. the fallback: a Rust builder that breaks AFTER it loaded ─────────────────────────────────────────────
{
  const RealInstance = WebAssembly.Instance;
  let instances = 0, traps = 0;
  /** make the Nth instance (1-based) misbehave; mode 'trap' = process() hands the module a colour id far past its palette (a genuine out-of-bounds panic, so an `unreachable` trap, in the real module), 'init' = init() throws */
  function breakInstances(which, mode) {
    WebAssembly.Instance = class extends RealInstance {
      constructor(mod, imp) {
        super(mod, imp); const k = ++instances;
        if (!which.includes(k)) return;
        const real = this.exports;
        const wrapped = { ...real };   // the real exports object is frozen (a Proxy over it must return the real values), so wrap a plain copy
        if (mode === 'trap') {
          // a genuine trap in the real module: every staged record gets a colour id far past the palette, so process() indexes
          // palette[col] out of bounds, the Rust panics, and panic = "abort" makes that an `unreachable` WebAssembly.RuntimeError
          let ptr = 0;
          wrapped.stage = n => (ptr = real.stage(n));
          wrapped.process = n => { traps++; const f = new Float64Array(real.memory.buffer, ptr, n * REC); for (let r = 0; r < n; r++) if (f[r * REC] !== 3) f[r * REC + 1] = 4e9; return real.process(n); };
        }
        if (mode === 'init') wrapped.init = () => { throw new RangeError('WebAssembly.Memory(): could not allocate memory'); };
        Object.defineProperty(this, 'exports', { value: wrapped });
      }
    };
  }
  const restore = () => { WebAssembly.Instance = RealInstance; instances = 0; traps = 0; };

  // does the planted trap really trap in the real module? (a fake that throws something else would prove nothing)
  {
    breakInstances([1], 'trap');
    const probe = await loadSlopes('?slopes=0&rustbuilder=1'); await probe.slopes.rustReady;
    let err = null; try { drive(probe.slopes.build(undefined, { wasm: true })); } catch (e) { err = e; }
    restore();
    say(err instanceof WebAssembly.RuntimeError && err.rustBuilderError === true, `the planted trap is a real WebAssembly.RuntimeError out of the module (${err && err.constructor.name}: ${err && err.message}), stamped rustBuilderError`);
  }

  /** a model of js/slopes-apartments.js buildOnce(): ONE builder for the city, one try/catch per "building" (a slice of the recorded calls) */
  const SLICES = 4;
  async function modelBuild(slopes, opts, { recipeBugAt = -1, log } = {}) {
    const B = slopes.build(undefined, opts);
    const per = Math.ceil(fx.records / SLICES);
    for (let b = 0; b < SLICES; b++) {
      try {
        if (b === recipeBugAt) throw new TypeError('a recipe bug in building ' + b);
        driveRange(B, b * per, Math.min(fx.records, (b + 1) * per));
      } catch (e) {
        if (e && e.rustBuilderError) throw e;   // the line js/slopes-apartments.js has
        log && log.push(b);                     // a recipe error: that building is skipped, the build goes on
      }
    }
    return hashes(B);
  }
  const run = (slopes, o) => slopes.withRustFallback(opts => modelBuild(slopes, opts, o));

  // reference: the JS builder through the same model
  const ref = await loadSlopes('?slopes=0'); const refOut = await run(ref.slopes, {});
  const names = ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aFacet', 'aSurface', 'index'];
  const same = o => names.every(n => o[n] === refOut[n]) && o.triangles === refOut.triangles;

  // a. clean Rust run through the model: still the Rust builder, same bytes
  {
    const l = await loadSlopes('?slopes=0&rustbuilder=1'); await l.slopes.rustReady;
    const out = await run(l.slopes, {});
    say(same(out) && l.slopes.rustBuilder === true && l.slopes.rustInfo().builds === 1, 'no fault: the Rust builder is used, once, and its bytes equal the JS builder\'s');
  }
  // b. the module traps mid-build (on the 8,192nd call, inside a quad/tri) in the FIRST builder only
  {
    breakInstances([1], 'trap');
    const l = await loadSlopes('?slopes=0&rustbuilder=1'); await l.slopes.rustReady;
    const out = await run(l.slopes, {});
    const info = l.slopes.rustInfo();
    say(traps >= 1, 'the module trapped during the build (' + traps + ' trap)');
    say(same(out), 'after the trap the build equals the JS builder\'s, byte for byte (' + out.triangles + ' triangles, all eight arrays): nothing is missing');
    say(l.slopes.rustBuilder === false && info.state === 'failed' && /unreachable|out of bounds|memory/i.test(info.error || ''), `and the Rust builder is switched off for good (state ${info.state}, "${info.error}")`);
    const before = instances;
    const later = l.slopes.build(undefined, { wasm: true });
    say(instances === before && typeof later.geometry === 'function', 'a later build(.., {wasm:true}) is the JS builder and never touches the module again');
    restore();
  }
  // c. an instance that will not even start (init throws, e.g. out of memory): the JS builder at once
  {
    breakInstances([1], 'init');
    const l = await loadSlopes('?slopes=0&rustbuilder=1'); await l.slopes.rustReady;
    const out = await run(l.slopes, {});
    say(same(out) && l.slopes.rustBuilder === false, 'an instance that cannot start (init throws): the build is the JS builder\'s and the Rust builder is off');
    restore();
  }
  // d. a RECIPE error is not the Rust builder's fault: that building is skipped as before and the Rust builder stays on
  {
    const l = await loadSlopes('?slopes=0&rustbuilder=1'); await l.slopes.rustReady;
    const skipped = [];
    await run(l.slopes, { recipeBugAt: 2, log: skipped });
    say(skipped.length === 1 && skipped[0] === 2 && l.slopes.rustBuilder === true && l.slopes.rustInfo().state === 'ready', 'a recipe error skips that one building and leaves the Rust builder switched on');
  }

  // e. the real apartment file has the shape the model above copies (it cannot be run here without three.js)
  const apt = fs.readFileSync(path.join(REPO, 'js/slopes-apartments.js'), 'utf8');
  say(/S\.withRustFallback\(\s*async opts =>[\s\S]{0,400}buildOnce\(specs, area, opts\)/.test(apt), 'js/slopes-apartments.js build() runs buildOnce() inside slopes.withRustFallback()');
  say(/catch \(e\) \{[^}]{0,400}if \(e && \(e\.rustBuilderError(?: \|\| e\.packOverflow)?\)\) throw e;[\s\S]{0,200}console\.error\('\[slopes-apartments\]'/.test(apt), 'its per-building catch lets a rustBuilderError out and only then logs and skips');
  say(/S\.buildChunked\(chunkTris, !!BUD\.packVertices, (rustOpts|buildOpts)\) : S\.build\(undefined, \1\)/.test(apt) && /buildOpts = pack \? \{ \.\.\.rustOpts, pack \} : rustOpts/.test(apt), 'both of its builders (plain and chunked) are made with the options the fallback passes');
  say(/untally\([\s\S]{0,200}area\.failed\.length = snap\.failed/.test(apt), 'a failed attempt takes back the area\'s tallies and failure list before the JS rebuild');
}

console.log(failed ? `\nFAIL: ${failed} check(s) failed${BREAK ? ' (--break: this is the expected result)' : ''}` : '\nPASS: the Rust builder is byte-identical to the JS builder');
process.exit(failed ? 1 : 0);
