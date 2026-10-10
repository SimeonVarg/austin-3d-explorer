/**
 * slopes-rust.js — the Rust/WebAssembly vertex store behind js/slopes.js build(), loaded ONLY when the page has
 * ?rustbuilder=1 (js/slopes.js imports it then; with the switch off this file is never requested).
 *
 * WHAT IT IS. The shared mesh builder (tri / quad / triN / facet: flat normals, planar quads welded to 4 vertices + 6
 * indices, colours as bytes, per-vertex surface) written in Rust, compiled to wasm/meshkernel.wasm (34 KB, no
 * dependencies; source and study in experiments/rust-mesh/ and docs/rust-study-2026-10-09.md). The generators still call
 * `B.quad(a, b, c, d, col, want)` with [x, y, z] arrays; this file writes the numbers into a staging buffer that lives in
 * Wasm memory, the module builds the vertex and index arrays there, and geometry() hands three.js typed-array VIEWS of
 * that memory (zero copy). `polygon` and `extrude` are js/slopes.js `shapeOps()`, the very same functions the JS builder
 * uses, so only the vertex store differs.
 *
 * BYTE-IDENTICAL, and held to it: scripts/verify/wasm-mesh-parity.mjs runs the same calls through the JS builder and
 * through this file and compares the sha256 of all eight arrays. It needs no browser.
 *
 * TWO TRAPS THIS FILE EXISTS TO AVOID (both found the hard way, see the study §5.2):
 *  - memory.grow() DETACHES every view of the old buffer, and a write into a detached Float64Array is silently dropped.
 *    Any call into the module that can allocate (process, palette_add) is followed by a re-take of the staging view.
 *  - one module INSTANCE PER BUILD: the output views point into that instance's memory, which must therefore never grow
 *    again after geometry(). A fresh instance is a 0.2 ms job.
 *
 * No DOM, no window: it runs in Node for the parity check.
 */

/**
 * Every call into the module (and every view of its memory) goes through `wasm()`, which stamps any error it throws with
 * `rustBuilderError = true` before rethrowing it. A trap ("unreachable", out of bounds), an out-of-memory RangeError or a
 * throwing import all arrive here as ordinary exceptions. The stamp is how js/slopes.js `withRustFallback()` and the
 * apartment builder tell "the Rust builder broke" (rebuild everything in JS, and stop using the module) from "this
 * building's recipe has a bug" (skip that building, as before). It is set only around calls into the module, never
 * around the generator's own code, so a recipe error can never be mistaken for a Wasm one.
 */
function wasm(fn) {
  try { return fn(); }
  catch (e) {
    let err = e;
    if (err === null || (typeof err !== 'object' && typeof err !== 'function')) { err = new Error('Rust builder: ' + String(e)); err.cause = e; }
    try { err.rustBuilderError = true; } catch (_) { /* a frozen error object */ }
    if (err.rustBuilderError !== true) { const w = new Error('Rust builder: ' + String(err && err.message || err)); w.cause = err; w.rustBuilderError = true; err = w; }
    throw err;
  }
}

const REC = 28;   // f64 per staged record: [op, tone, hasWant, want xyz, a xyz, b xyz, c xyz, d xyz, na xyz, nb xyz, nc xyz, facet]

async function compile(wasmUrl) {
  // compileStreaming needs Content-Type: application/wasm; fall back to arrayBuffer() for a host that serves another type
  try { return await WebAssembly.compileStreaming(fetch(wasmUrl)); }
  catch (e) {
    const r = await fetch(wasmUrl);
    if (!r.ok) throw new Error(wasmUrl + ' → HTTP ' + r.status);
    return WebAssembly.compile(await r.arrayBuffer());
  }
}

/**
 * Compile the module once and return `buildRust(initialCapacity)`, a drop-in for js/slopes.js build().
 * `module` (a WebAssembly.Module) replaces the fetch; the parity check uses it.
 */
export async function loadRustBuilder({ wasmUrl, module, stageRecords = 8192, reserveVertices = 0, shapeOps, hexToRgb01, three, info }) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  const mod = module || await compile(wasmUrl);
  if (info) info.compileMs = +((typeof performance !== 'undefined' ? performance.now() : 0) - t0).toFixed(1);

  return function buildRust(/* initialCapacity: unused, the module grows by itself; reserveVertices is the hint */) {
    const T = three();
    let X, mem, stagePtr, S, n = 0;
    const CAP = stageRecords;
    wasm(() => {
      X = new WebAssembly.Instance(mod, {}).exports;
      X.init(reserveVertices);
      mem = X.memory;
      stagePtr = X.stage(CAP);
      S = new Float64Array(mem.buffer, stagePtr, CAP * REC);
    });
    if (info) info.builds++;
    const retake = () => { if (S.buffer !== mem.buffer) S = new Float64Array(mem.buffer, stagePtr, CAP * REC); };
    const flush = () => { if (!n) return; wasm(() => { X.process(n); n = 0; retake(); }); };

    // A tone is the same [day, golden, night] array object for every vertex it colours, so its three hex lookups and
    // the palette entry are made once per object (the JS builder's colCache, with the same lifetime).
    const ids = new WeakMap();
    const bytes = h => { const f = hexToRgb01(h); return [Math.round(f[0] * 255), Math.round(f[1] * 255), Math.round(f[2] * 255)]; };
    const toneId = col => {
      let i = ids.get(col);
      if (i === undefined) {
        const d = bytes(col[0]), g = bytes(col[1]), k = bytes(col[2]), s = col.surface || [0, 0, 0, 0];
        i = wasm(() => X.palette_add(d[0], d[1], d[2], g[0], g[1], g[2], k[0], k[1], k[2], s[0], s[1], s[2], s[3]));
        ids.set(col, i);
        wasm(retake);             // palette_add can grow memory
      }
      return i;
    };
    const put3 = (o, p) => { S[o] = p[0]; S[o + 1] = p[1]; S[o + 2] = p[2]; };

    function tri(a, b, c, col, want) {
      const id = toneId(col), o = n * REC;   // id FIRST: toneId() may re-take S, and `S[o + 1] = toneId(col)` would write to the old one
      S[o] = 0; S[o + 1] = id;
      if (want) { S[o + 2] = 1; put3(o + 3, want); } else S[o + 2] = 0;
      put3(o + 6, a); put3(o + 9, b); put3(o + 12, c);
      if (++n === CAP) flush();
    }
    function quad(a, b, c, d, col, want) {
      const id = toneId(col), o = n * REC;
      S[o] = 1; S[o + 1] = id;
      if (want) { S[o + 2] = 1; put3(o + 3, want); } else S[o + 2] = 0;
      put3(o + 6, a); put3(o + 9, b); put3(o + 12, c); put3(o + 15, d);
      if (++n === CAP) flush();
    }
    function triN(a, b, c, na, nb, nc, col) {
      const id = toneId(col), o = n * REC;
      S[o] = 2; S[o + 1] = id; S[o + 2] = 0;
      put3(o + 6, a); put3(o + 9, b); put3(o + 12, c); put3(o + 18, na); put3(o + 21, nb); put3(o + 24, nc);
      if (++n === CAP) flush();
    }
    function facet(v) { const o = n * REC; S[o] = 3; S[o + 27] = v ? 1 : 0; if (++n === CAP) flush(); }

    const { polygon, extrude } = shapeOps(tri, triN, quad);

    function geometry() {
      flush();
      return wasm(() => {
        X.release_stage();
        const g = new T.BufferGeometry(), v = X.vertex_count(), m = mem.buffer;
        // Views of the module's memory, not copies: see the header. Nothing may grow this memory from here on.
        g.setAttribute('position', new T.BufferAttribute(new Float32Array(m, X.position_ptr(), v * 3), 3));
        g.setAttribute('normal', new T.BufferAttribute(new Float32Array(m, X.normal_ptr(), v * 3), 3));
        g.setAttribute('cDay', new T.BufferAttribute(new Uint8Array(m, X.day_ptr(), v * 3), 3, true));
        g.setAttribute('cGold', new T.BufferAttribute(new Uint8Array(m, X.golden_ptr(), v * 3), 3, true));
        g.setAttribute('cNight', new T.BufferAttribute(new Uint8Array(m, X.night_ptr(), v * 3), 3, true));
        g.setAttribute('aFacet', new T.BufferAttribute(new Uint8Array(m, X.facet_ptr(), v), 1, false));
        g.setAttribute('aSurface', new T.BufferAttribute(new Float32Array(m, X.surface_ptr(), v * 4), 4));
        g.setIndex(new T.BufferAttribute(new Uint32Array(m, X.index_ptr(), X.index_count()), 1));
        if (info) info.lastWasmBytes = m.byteLength;
        g.computeBoundingSphere();
        return g;
      });
    }
    return { tri, triN, quad, polygon, extrude, geometry, facet, get triangles() { flush(); return wasm(() => X.triangle_count()); } };
  };
}
