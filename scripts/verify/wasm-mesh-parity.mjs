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
 *   node scripts/verify/wasm-mesh-parity.mjs            exit 0 = identical
 *   node scripts/verify/wasm-mesh-parity.mjs --break    nudges one coordinate of the Rust builder's input only: it must report MISMATCH and exit 1
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

/** the Moontower's recorded calls through any builder with the slopes.js API; returns the eight arrays */
function drive(B, { nudge = false } = {}) {
  const S = fx.stream, mid = Math.floor(fx.records / 2);
  for (let i = 0, o = 0; i < fx.records; i++, o += REC) {
    const op = S[o];
    if (op === 3) { B.facet(S[o + 27] !== 0); continue; }
    const col = tones[S[o + 1]], P = k => [S[o + k], S[o + k + 1], S[o + k + 2]];
    const a = P(6); if (nudge && i === mid) a[0] += 1e-9 * Math.max(1, Math.abs(a[0]));
    const want = S[o + 2] ? P(3) : undefined;
    if (op === 0) B.tri(a, P(9), P(12), col, want);
    else if (op === 1) B.quad(a, P(9), P(12), P(15), col, want);
    else B.triN(a, P(9), P(12), P(18), P(21), P(24), col);
  }
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
  say(names.every(n => (BREAK ? true : rustOut[n] === exp[n])), 'and they equal the sha256 of what the real in-app build produced (recorded in expected.json)');
}

console.log(failed ? `\nFAIL: ${failed} check(s) failed${BREAK ? ' (--break: this is the expected result)' : ''}` : '\nPASS: the Rust builder is byte-identical to the JS builder');
process.exit(failed ? 1 : 0);
