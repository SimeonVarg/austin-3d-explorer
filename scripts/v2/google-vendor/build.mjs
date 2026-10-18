// Rebuilds v2/vendor/3d-tiles-renderer/tiles-google.min.js, the one library file Google mode (v2/google.js) loads:
// 3d-tiles-renderer 0.5.3 (TilesRenderer, GLTFExtensionsPlugin; Apache-2.0, NASA-AMMOS/3DTilesRendererJS) + three 0.186.0's
// DRACOLoader. Only 'three' and three's GLTFLoader stay outside it (v2's import map serves the vendored copies, so the page has
// one three); every other three addon it needs is bundled in. The Draco decoder (v2/vendor/draco/) is three 0.186.0's
// examples/jsm/libs/draco/gltf/ copy (Apache-2.0).
//
//   mkdir /tmp/tr && cd /tmp/tr && npm init -y && npm i --ignore-scripts 3d-tiles-renderer@0.5.3 three@0.186.0 esbuild@0.25.10
//   node scripts/v2/google-vendor/build.mjs /tmp/tr
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const install = path.resolve(process.argv[2] || '.');
const { build } = createRequire(path.join(install, 'package.json'))('esbuild');
const KEEP_OUTSIDE = new Set(['three', 'three/addons/loaders/GLTFLoader.js']);
const jsm = path.join(install, 'node_modules/three/examples/jsm');
const out = path.resolve(here, '../../../v2/vendor/3d-tiles-renderer/tiles-google.min.js');
await build({
  banner: { js: '/* 3d-tiles-renderer 0.5.3 (NASA-AMMOS/3DTilesRendererJS, Apache-2.0, see LICENSE) + three 0.186.0 DRACOLoader (MIT). Built by scripts/v2/google-vendor/build.mjs */' },
  entryPoints: [path.join(here, 'entry.js')], bundle: true, format: 'esm', minify: true, legalComments: 'eof', outfile: out,
  nodePaths: [path.join(install, 'node_modules')],
  plugins: [{ name: 'three-split', setup(b) {
    b.onResolve({ filter: /^three(\/|$)/ }, (a) => {
      if (KEEP_OUTSIDE.has(a.path)) return { path: a.path, external: true };
      const rest = a.path.replace(/^three\/(addons|examples\/jsm)\//, '');
      if (rest !== a.path) return { path: path.join(jsm, rest) };
      return { path: a.path, external: true };
    });
  } }],
});
console.log('wrote', out, fs.statSync(out).size, 'bytes');
