// Load the production hooks in Node without changing the app's browser import map.
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../v2/vendor/three/build/three.module.js';
export { THREE };
export async function fineRuntime(source = fs.readFileSync(new URL('../../v2/tiles.js', import.meta.url), 'utf8')) {
  const context = vm.createContext({ Uint16Array, Uint8Array, DataView, Float32Array, Math, atob, URL, URLSearchParams });
  const mock = values => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [k, v] of Object.entries(values)) this.setExport(k, v);
  }, { context });
  const three = mock(THREE), loader = mock({ GLTFLoader: class {} }), meshopt = mock({ MeshoptDecoder: {} });
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(s => s === 'three' ? three : s.includes('GLTFLoader') ? loader : meshopt);
  await mod.evaluate();
  return mod.namespace;
}
