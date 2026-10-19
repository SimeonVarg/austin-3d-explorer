// Decode the actual compressed trial files and evaluate the production shader's size/blend expressions.
// node --experimental-vm-modules scripts/v2/check_fine_colours.mjs
// --round1 is a negative control: must fail on c0241d4e's empty black patches.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { getPixels } from 'ndarray-pixels';
import { fineRuntime, THREE } from './fine_runtime_test.mjs';

await MeshoptDecoder.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const runtime = await fineRuntime(), round1 = process.argv.includes('--round1');
const srgb = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const smoothstep = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const delta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const EPS = 0.0005; // linear RGB, includes U16 and half-float quantization (not an 8-bit display tolerance)
const rows = [];
for (const tile of ['t_-1_-4', 't_1_3', 't_2_0', 't_3_2']) {
  const file = `v2/tiles/${tile}.glb`;
  const doc = round1 ? await io.readBinary(execFileSync('git', ['show', `c0241d4e:${file}`], { maxBuffer: 1 << 28 })) : await io.read(file);
  const fine = doc.getRoot().getExtras().fine, raw = Buffer.from(fine.table, 'base64');
  const table = runtime.fineTexture(fine);
  assert.equal(table.tex.colorSpace, THREE.NoColorSpace);
  assert.equal(table.tex.premultiplyAlpha, false);
  assert.equal(table.tex.flipY, false);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  const material = new THREE.MeshStandardMaterial(); runtime.fineable(material, table); material.onBeforeCompile(shader);
  assert(shader.vertexShader.includes('texelFetch(uFineTex,'));
  const decodeExpr = shader.vertexShader.match(/vFineSize = ([^;]+);/)[1];
  const decode = new Function('_fine', 'uFineDecode', 'exp2', `return ${decodeExpr}`);
  const blendExpr = shader.fragmentShader.match(/fineK = ([^;]+);/)[1]
    .replace('length(vFineW - cameraPosition)', 'distance');
  const weight = new Function('mpp', 'vFineSize', 'distance', 'uFine', 'uFineRange', 'smoothstep', `return ${blendExpr}`);
  const validExpr = shader.vertexShader.match(/vFineValid = ([^;]+);/)[1];
  const validity = new Function('patch', 'uFineCount', 'uFineDecode', 'meanEntry', 'normalEntry', 'dot', `return ${validExpr}`);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const { uFine, uFineRange, uFineDecode } = shader.uniforms;
  const fetch = (id, offset) => {
    // Same integer texel coordinates as fineEntry, including row boundaries and high patch bytes.
    const texel = id * 2 + offset, x = texel % table.size.x, y = Math.floor(texel / table.size.x);
    const base = (y * table.size.x + x) * 4;
    return [0, 1, 2, 3].map(k => THREE.DataUtils.fromHalfFloat(table.tex.image.data[base + k]));
  };
  for (let id = 0; id < fine.count; id++) {
    const col = fetch(id, 0), normal = fetch(id, 1);
    const expected = [0, 1, 2].map(k => raw.readUInt16LE(id * 12 + k * 2) / 65535);
    assert(delta(col.slice(0, 3), expected) < EPS, `${tile} patch ${id}: wrong texel or colour space`);
    assert.equal(col[3], 1); assert.equal(normal[3], 1);
    assert(Math.abs(Math.hypot(...normal.slice(0, 3)) - 1) < 0.002, `${tile} patch ${id}: invalid normal`);
  }
  const meanEntry = { a: 1 }, normalEntry = { a: 1, xyz: [0, 0, 1] };
  assert.equal(validity(0, fine.count, uFineDecode.value, meanEntry, normalEntry, dot), 1);
  for (const [patch, count, decodeValue, colour, normal] of [
    [0, fine.count, uFineDecode.value, { a: 0 }, normalEntry], // empty or missing texture
    [0, fine.count, uFineDecode.value, meanEntry, { a: 1, xyz: [0, 0, 0] }],
    [0, fine.count, { x: 0, y: 16 }, meanEntry, normalEntry], // missing size uniform
    [fine.count, fine.count, uFineDecode.value, meanEntry, normalEntry],
  ]) assert.equal(validity(patch, count, decodeValue, colour, normal, dot), 0, 'broken GPU lookup must preserve original shading');
  let vertices = 0, plain = 0, small = 0, evaluations = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const A = p.getAttribute('_FINE'), UV = p.getAttribute('TEXCOORD_0'), mat = p.getMaterial();
    assert.equal(A.getNormalized(), false);
    const texture = mat.getBaseColorTexture(), pixels = texture && await getPixels(texture.getImage(), texture.getMimeType());
    for (let i = 0; i < A.getCount(); i++) {
      const a = A.getElement(i, []), id = a[2] + a[3] * 256;
      const size = decode({ y: a[1] }, uFineDecode.value, x => 2 ** x);
      let original = mat.getBaseColorFactor().slice(0, 3);
      if (pixels) {
        const uv = UV.getElement(i, []);
        const x = Math.max(0, Math.min(pixels.shape[0] - 1, Math.floor(uv[0] * pixels.shape[0])));
        const y = Math.max(0, Math.min(pixels.shape[1] - 1, Math.floor(uv[1] * pixels.shape[1])));
        original = original.map((v, k) => v * srgb(pixels.get(x, y, k) / 255));
      }
      const mean = fetch(id, 0).slice(0, 3);
      if (a[1]) {
        assert(id < fine.count && Number.isFinite(size) && size > 0);
        assert(Math.max(...mean) > EPS || Math.max(...original) <= EPS,
          `${tile} vertex ${i}: black patch mean on a nonblack facade`);
        small++;
      } else plain++;
      for (const footprint of [1, 2, 4]) {
        const mpp = a[1] ? size / footprint : 4;
        const k = weight(mpp, size, 1800, uFine.value, uFineRange.value, smoothstep);
        const colour = k > 0 ? mix(original, mean, k) : original;
        assert(colour.every(Number.isFinite));
        if (!a[1] || footprint === 4) assert(delta(colour, original) < 1e-8, 'large feature changed');
        if (a[1] && footprint === 1) assert(delta(colour, mean) < EPS, 'small feature missed its patch mean');
        assert(k >= 0 && k <= 1);
        // Near-view guarantee includes tiny subpixel detail, not just large pieces.
        for (const distance of [100, 350]) {
          const nearK = weight(mpp, size, distance, uFine.value, uFineRange.value, smoothstep);
          assert.equal(nearK, 0); assert.deepEqual(mix(original, mean, nearK), original);
        }
        evaluations++;
      }
      // A failed/missing GPU lookup carries zero alpha: the production guard must select k=0.
      assert(shader.fragmentShader.includes('if (vFineValid < 0.999) fineK = 0.0;'));
      vertices++;
    }
  }
  rows.push({ tile, vertices, plain, small, evaluations, patches: fine.count });
  table.tex.dispose(); material.dispose();
}
console.log(JSON.stringify(rows));
console.log('PASS decoded per-vertex RGB at 1/2/4 px, exact broad/near preservation, linear texel lookup, unit normals, no unsupported black means');
