// The in-memory edits applied to js/slopes.js and js/slopes-apartments.js so the generator can run without a map. Pure string
// functions with no Node or DOM dependency: used by app-env.mjs (Node) and by ../bench-browser-build.html (Chrome).

/** the stubs the sources expect on `window` before they load; `W` is the global object (globalThis) */
export function installStubs(W) {
  const EARTH = 2 * Math.PI * 6371008.8;   // maplibregl.MercatorCoordinate: the standard Web Mercator formulas MapLibre uses
  W.maplibregl = { MercatorCoordinate: class {
    constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
    static fromLngLat(ll, alt = 0) { const lat = ll.lat; return new this((180 + ll.lng) / 360, (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360, alt / (EARTH * Math.cos(lat * Math.PI / 180))); }
    meterInMercatorCoordinateUnits() { return 1 / (EARTH * Math.cos(this.toLngLat().lat * Math.PI / 180)); }
    toLngLat() { const y2 = 180 - this.y * 360; return { lng: this.x * 360 - 180, lat: 360 / Math.PI * Math.atan(Math.exp(y2 * Math.PI / 180)) - 90 }; }
    toAltitude() { return this.z * EARTH * Math.cos(this.toLngLat().lat * Math.PI / 180); }
  } };
  const loose = () => new Proxy({}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : (k in t ? t[k] : '') });
  Object.assign(W, { CityLighting: loose(), WallPatterns: loose(), RoofTiles: loose(), GroundTexture: loose(), CityTexture: loose() });
}
/** after js/slopes.js has run: stand-ins for the pieces of the page the generator reaches for */
export function installLateStubs(W) {
  W.WallPatterns = { register() {} };   // texture-pattern registry: not part of the mesh
  // night lights: deterministic stand-ins (they only choose which windows are lit; no geometry change)
  W.CityNight = { tune: { on: false, fixtureSize: 0.12, unlitGlass: 0, storefrontMaxBase: 0, commercialOccupancy: 0.5, windowScatter: false },
    register() {}, registerFixtures() {}, emissive: c => c, hash: () => 0.3, room: () => ({ lit: true }) };
  W.slopes.material = () => ({ dispose() {} });   // build() calls it last; it needs a GL context we do not have
}
export function patchSlopes(src, { record = false, timeBuilder = false } = {}) {
  // js/slopes.js sets its origin inside the map's onAdd(); do what onAdd does
  src = src.replace('let originMerc = null, originScale = 0;',
    'let originMerc = maplibregl.MercatorCoordinate.fromLngLat({ lng: -97.7393587, lat: 30.2860098 }, 0), originScale = originMerc.meterInMercatorCoordinateUnits();');
  if (record || timeBuilder) {
    // Wrap the builder's three emitters. Depth guard: quad() falls back to tri() for a bent quad, polygon() and extrude()
    // call them too; only the OUTERMOST call counts.
    const wrap = (name, args, rec) => {
      const head = `    function ${name}(${args}) {`;
      if (!src.includes(head)) throw new Error('slopes.js moved: ' + head);
      src = src.replace(head, timeBuilder
        ? `    function ${name}(${args}) { if (globalThis.__DEPTH) return ${name}0(${args}); globalThis.__DEPTH = 1; const t_ = performance.now(); try { return ${name}0(${args}); } finally { globalThis.__DEPTH = 0; globalThis.__BMS += performance.now() - t_; } }\n    function ${name}0(${args}) {`
        : `    function ${name}(${args}) { const R_ = globalThis.__REC; if (R_ && !globalThis.__DEPTH) R_(${rec}); globalThis.__DEPTH = (globalThis.__DEPTH || 0) + 1; try { return ${name}0(${args}); } finally { globalThis.__DEPTH--; } }\n    function ${name}0(${args}) {`);
    };
    wrap('tri', 'a, b, c, col, want', '0, a, b, c, null, col, want, null, null, null');
    wrap('quad', 'a, b, c, d, col, want', '1, a, b, c, d, col, want, null, null, null');
    wrap('triN', 'a, b, c, na, nb, nc, col', '2, a, b, c, null, col, null, na, nb, nc');
    if (record) src = src.replace('    function facet(v) { _facet = v ? 1 : 0; }', '    function facet(v) { if (globalThis.__REC) globalThis.__REC(3, null, null, null, null, null, null, null, null, null, v); _facet = v ? 1 : 0; }');
  }
  return src;
}
/** one line appended inside the IIFE so build() is reachable */
export function patchApartments(src) {
  // FACET TAP (experiments/facet): report every wall piece the cell tiler is about to cut, with the recipe skin and the triangles it made
  // the two call sites, with and without the ?facadeshader hook line js/slopes-apartments.js now carries (the tap measures the cell tiler, so the hook stays off)
  const pick = (a, b) => src.includes(a) ? a : b;
  const site1 = pick("      tileFace(B, { W: sub, len, z0, z1, cut: cutAt ? cutAt(0) : null }, skin, P);", "      if (!(B.facetWalls && B.facetWalls.take(facetPiece(sub, len, z0, z1, ctx, skin, sk, band, P, cutAt ? cutAt(0) : null, spec)))) tileFace(B, { W: sub, len, z0, z1, cut: cutAt ? cutAt(0) : null }, skin, P);");
  const site2 = pick("      tileFace(B, { W: subR, len: sHi - sLo, z0, z1, cut: opts.cutAt ? opts.cutAt(sLo) : null }, skin, P);", "      if (!(B.facetWalls && B.facetWalls.take(facetPiece(subR, sHi - sLo, z0, z1, ctx, skin, sk, band, P, opts.cutAt ? opts.cutAt(sLo) : null, spec)))) tileFace(B, { W: subR, len: sHi - sLo, z0, z1, cut: opts.cutAt ? opts.cutAt(sLo) : null }, skin, P);");
  if (!src.includes(site1) || !src.includes(site2)) throw new Error('js/slopes-apartments.js moved: the two tileFace call sites');
  const pre = "const rq_ = globalThis.__TF && globalThis.__TFQ ? [] : null; let q0_; if (rq_) { q0_ = B.quad; B.quad = function () { rq_.push(Array.prototype.slice.call(arguments, 0, 5)); return q0_.apply(this, arguments); }; }";
  src = src.replace(site1, "      { const t0_ = B.triangles; const cut_ = cutAt ? cutAt(0) : null; " + pre + " tileFace(B, { W: sub, len, z0, z1, cut: cut_ }, skin, P); if (rq_) B.quad = q0_; if (globalThis.__TF) globalThis.__TF({ spec, band, sk, ctx, skin, len, z0, z1, cut: cut_, inset: 0, tris: B.triangles - t0_, W: sub, P, key, quads: rq_ }); }");
  src = src.replace(site2, "      { const t0_ = B.triangles; const cut_ = opts.cutAt ? opts.cutAt(sLo) : null; " + pre + " tileFace(B, { W: subR, len: sHi - sLo, z0, z1, cut: cut_ }, skin, P); if (rq_) B.quad = q0_; if (globalThis.__TF) globalThis.__TF({ spec, band, sk, ctx, skin, len: sHi - sLo, z0, z1, cut: cut_, inset: d, tris: B.triangles - t0_, W: subR, P, key, quads: rq_ }); }");
  const tail = src.lastIndexOf('\n})();');
  return src.slice(0, tail) + '\n  window.__apts = { build, buildingOne, count, APTS, okBuildings, resetCount };\n' + src.slice(tail);
}
/** the catalog exactly as startFetch() assembles it, minus the lazy 'riverside' area */
export async function catalog(readJson) {
  const idx = await readJson('data/apartments/index.json');
  const load = f => readJson(f.startsWith('data/') ? f : 'data/apartments/' + f);
  const individual = await Promise.all(idx.buildings.map(load));
  const bundles = await Promise.all(idx.collections.map(async f => (await load(f)).buildings));
  const own = new Set(individual.map(b => b.id).filter(Boolean));
  return individual.concat(bundles.flat().filter(b => !own.has(b.id)));
}
/** a builder that does nothing, for timing the generator alone */
export function nullBuilder(W) {
  return () => { let t = 0; const nop = () => { t++; }; const T = W.THREE;
    return { tri: nop, triN: nop, quad: nop, polygon: nop, extrude: nop, facet() {}, geometry() { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(3), 3)); g.setIndex(new T.BufferAttribute(new Uint32Array(3), 1)); return g; }, get triangles() { return 0; }, get calls() { return t; } }; };
}

/**
 * END-TO-END EXPERIMENT (nothing in the site does this). Swap js/slopes.js build()'s vertex store (push / emit / tri / quad / triN /
 * facet / geometry) for a thin adapter over meshkernel.wasm, keeping the app's own `polygon` and `extrude` text verbatim. The
 * generator is unchanged: it still calls B.quad(a, b, c, d, col, want) with [x,y,z] arrays; the adapter writes the numbers into a
 * 8192-record staging buffer in Wasm memory and flushes it. `globalThis.__RUST_MOD` must hold the compiled WebAssembly.Module and
 * `globalThis.__RUST_RESERVE` an optional vertex-count hint.
 */
export function patchSlopesWasm(src) {
  const a = src.indexOf('  function build(initialCapacity = 1 << 16) {');
  const polyStart = src.indexOf('    /** A planar polygon, any orientation', a);
  const geomStart = src.indexOf('    function geometry() {', a);
  const endMark = '    return { tri, triN, quad, polygon, extrude, geometry, facet, get triangles() { return tris; } };\n  }';
  const end = src.indexOf(endMark, a);
  if (a < 0 || polyStart < a || geomStart < polyStart || end < geomStart) throw new Error('js/slopes.js moved: build() markers');
  const head = `  function build(initialCapacity = 1 << 16) {
    const T = window.THREE;
    const REC = 28, CAP = 8192;
    const X = new WebAssembly.Instance(globalThis.__RUST_MOD, {}).exports;
    X.init(globalThis.__RUST_RESERVE || 0);
    const ids = new WeakMap();
    const hexB = h => { const f = hexToRgb01(h); return [Math.round(f[0] * 255), Math.round(f[1] * 255), Math.round(f[2] * 255)]; };
    const toneId = col => {
      let i = ids.get(col);
      if (i === undefined) { const d = hexB(col[0]), g = hexB(col[1]), n = hexB(col[2]), s = col.surface || [0, 0, 0, 0]; i = X.palette_add(d[0], d[1], d[2], g[0], g[1], g[2], n[0], n[1], n[2], s[0], s[1], s[2], s[3]); ids.set(col, i); if (S.buffer !== X.memory.buffer) retake(); }
      return i;
    };
    const stagePtr = X.stage(CAP);
    let S = new Float64Array(X.memory.buffer, stagePtr, CAP * REC), n = 0;
    const retake = () => { S = new Float64Array(X.memory.buffer, stagePtr, CAP * REC); };
    // memory.grow DETACHES every view of the old buffer, and a write into a detached Float64Array is silently dropped. Any call
    // into the module that can allocate (process, palette_add) must be followed by retake(). A first version of this adapter only
    // did it after process(): palette_add growing memory mid-batch lost 5,574 of 269,332 triangles in one building, found only
    // because the end-to-end check compares the sha256 of every buffer against the app's own build.
    const flush = () => { if (!n) return; X.process(n); n = 0; retake(); };
    const put3 = (o, p) => { S[o] = p[0]; S[o + 1] = p[1]; S[o + 2] = p[2]; };
    function tri(a, b, c, col, want) {
      const id = toneId(col), o = n * REC; S[o] = 0; S[o + 1] = id;   // id first: toneId() may re-take S, and S[o + 1] = f() would write to the OLD S
      if (want) { S[o + 2] = 1; put3(o + 3, want); } else S[o + 2] = 0;
      put3(o + 6, a); put3(o + 9, b); put3(o + 12, c);
      if (++n === CAP) flush();
    }
    function quad(a, b, c, d, col, want) {
      const id = toneId(col), o = n * REC; S[o] = 1; S[o + 1] = id;
      if (want) { S[o + 2] = 1; put3(o + 3, want); } else S[o + 2] = 0;
      put3(o + 6, a); put3(o + 9, b); put3(o + 12, c); put3(o + 15, d);
      if (++n === CAP) flush();
    }
    function triN(a, b, c, na, nb, nc, col) {
      const id = toneId(col), o = n * REC; S[o] = 2; S[o + 1] = id; S[o + 2] = 0;
      put3(o + 6, a); put3(o + 9, b); put3(o + 12, c); put3(o + 18, na); put3(o + 21, nb); put3(o + 24, nc);
      if (++n === CAP) flush();
    }
    function facet(v) { const o = n * REC; S[o] = 3; S[o + 27] = v ? 1 : 0; if (++n === CAP) flush(); }
`;
  const geom = `    function geometry() {
      flush(); X.release_stage();
      const g = new T.BufferGeometry(), v = X.vertex_count(), m = X.memory.buffer;
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(m, X.position_ptr(), v * 3), 3));
      g.setAttribute('normal', new T.BufferAttribute(new Float32Array(m, X.normal_ptr(), v * 3), 3));
      g.setAttribute('cDay', new T.BufferAttribute(new Uint8Array(m, X.day_ptr(), v * 3), 3, true));
      g.setAttribute('cGold', new T.BufferAttribute(new Uint8Array(m, X.golden_ptr(), v * 3), 3, true));
      g.setAttribute('cNight', new T.BufferAttribute(new Uint8Array(m, X.night_ptr(), v * 3), 3, true));
      g.setAttribute('aFacet', new T.BufferAttribute(new Uint8Array(m, X.facet_ptr(), v), 1, false));
      g.setAttribute('aSurface', new T.BufferAttribute(new Float32Array(m, X.surface_ptr(), v * 4), 4));
      g.setIndex(new T.BufferAttribute(new Uint32Array(m, X.index_ptr(), X.index_count()), 1));
      g.computeBoundingSphere();
      return g;
    }
`;
  const tail = '    return { tri, triN, quad, polygon, extrude, geometry, facet, get triangles() { flush(); return X.triangle_count(); } };\n  }';
  return src.slice(0, a) + head + src.slice(polyStart, geomStart) + geom + tail + src.slice(end + endMark.length);
}
