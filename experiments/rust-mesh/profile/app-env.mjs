// Loads the REAL js/slopes.js + js/slopes-apartments.js into this Node process (no browser, no map) and returns the
// apartment generator's internal build() plus the real catalog. The sources are read from the repo and patched IN MEMORY
// only (app-patch.mjs); nothing on disk changes.
// Run in THIS realm (vm.runInThisContext), not a vm.createContext sandbox: a sandbox makes every global lookup (Math.min,
// Float32Array, ...) go through an interceptor, which inflated three.js's Box3 loop about five-fold in a first attempt
// (38 s instead of 7 s for the same build).
import vm from 'node:vm'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installStubs, installLateStubs, patchSlopes, patchApartments, catalog, nullBuilder } from './app-patch.mjs';
export const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../') + '/';

export async function loadApp({ record = false, timeBuilder = false, nullBuilder: useNull = false, wasm = null, threeJs = process.env.THREE_JS } = {}) {
  if (!threeJs) throw new Error('set THREE_JS to three@0.159.0 build/three.min.js (https://unpkg.com/three@0.159.0/build/three.min.js, the same file index.html loads)');
  const ctx = globalThis, realError = console.error;
  console.warn = console.log = console.info = () => {};
  ctx.window = ctx; ctx.self = ctx; ctx.location = { search: '?slopes=0&facadefilter=0' + (process.env.EXTRA_Q || '') + (wasm ? '&rustbuilder=1' + (process.env.RESERVE ? '&rustreserve=' + process.env.RESERVE : '') : ''), href: 'http://x/' };
  ctx.document = { getElementById: () => null, hidden: false, createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, body: {} };
  ctx.addEventListener = () => {}; ctx.devicePixelRatio = 1;
  Object.defineProperty(ctx, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  installStubs(ctx);
  vm.runInThisContext(fs.readFileSync(threeJs, 'utf8'));
  // REAL_PATTERNS=1: the page's own js/wall-patterns.js (it loads BEFORE js/slopes.js there). register() writes each patterned material's surface row back
  // into the palette, so the mesh depends on it; the stand-in is a no-op and makes a different mesh.
  const realWallPatterns = !!process.env.REAL_PATTERNS;
  if (realWallPatterns) { ctx.WallPatterns = undefined; vm.runInThisContext(fs.readFileSync(R + 'js/wall-patterns.js', 'utf8'), { filename: 'wall-patterns.js' }); }
  const wpKeep = ctx.WallPatterns;
  let slopesSrc = patchSlopes(fs.readFileSync(R + 'js/slopes.js', 'utf8'), { record, timeBuilder });
  if (wasm) {   // END-TO-END: the REAL ?rustbuilder=1 path of js/slopes.js (its loader block, js/slopes-rust.js, the committed .wasm), behind the real generator
    ctx.fetch = async url => new Response(fs.readFileSync(wasm), { headers: { 'content-type': 'application/wasm' } });
    ctx.THREE_LOADED = true;
    const file = R + 'js/slopes.js';
    vm.runInThisContext(slopesSrc, { filename: 'file://' + file, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  } else vm.runInThisContext(slopesSrc, { filename: 'slopes.js' });
  installLateStubs(ctx);
  if (realWallPatterns) ctx.WallPatterns = wpKeep;
  // REAL_NIGHT=1: the page's own js/city-night.js instead of the stand-in. The stand-in lights every window the same warm tone; the real one picks a
  // lit window's tone and brightness per window, which is what makes the real page's palette far bigger (see the packverts notes).
  if (process.env.REAL_NIGHT) { ctx.CityNight = undefined; vm.runInThisContext(fs.readFileSync(R + 'js/city-night.js', 'utf8'), { filename: 'city-night.js' }); }
  if (wasm) { await ctx.slopes.rustReady; if (!ctx.slopes.rustBuilder) throw new Error('?rustbuilder=1 did not load the Rust builder: ' + JSON.stringify(ctx.slopes.rustInfo())); }
  vm.runInThisContext(patchApartments(fs.readFileSync(process.env.APARTMENTS_SRC || R + 'js/slopes-apartments.js', 'utf8')), { filename: 'slopes-apartments.js' });   // APARTMENTS_SRC: another version of the file (the split's before/after check)
  if (useNull) ctx.slopes.build = nullBuilder(ctx);
  if (process.env.HINT) { const orig = ctx.slopes.build; ctx.slopes.build = () => orig(Number(process.env.HINT)); }   // the app's own `build(initialCapacity)` parameter: pass the vertex count up front (one line in the app)
  let specs = await catalog(async f => JSON.parse(fs.readFileSync(R + f, 'utf8')));
  if (process.env.ONLY) { const keep = process.env.ONLY.split(','); specs = specs.filter(s => keep.includes(s.name)); }
  return { A: ctx.__apts, specs, ctx, realError };
}
