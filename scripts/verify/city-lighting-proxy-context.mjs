// CPU regression for CityLighting's real proxy and pinned Three r159 buffer
// owners. Renderer disposal leaves geometry disposal listeners registered;
// disposing a retained proxy after restoration must not delete an old buffer.
// --source=<file> checks a preserved production source. No browser or GPU.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
const repo = option('repo') ? pathToFileURL(path.resolve(option('repo')) + path.sep) : new URL('../../', import.meta.url);
const sourceURL = option('source') ? pathToFileURL(path.resolve(option('source'))) : new URL('js/city-lighting.js', repo);
const THREE = await import(new URL('scripts/buildings/node_modules/three/build/three.module.js', repo));
const { WebGLAttributes } = await import(new URL('scripts/buildings/node_modules/three/src/renderers/webgl/WebGLAttributes.js', repo));
const { WebGLGeometries } = await import(new URL('scripts/buildings/node_modules/three/src/renderers/webgl/WebGLGeometries.js', repo));
const { WebGLObjects } = await import(new URL('scripts/buildings/node_modules/three/src/renderers/webgl/WebGLObjects.js', repo));
assert.equal(THREE.REVISION, '159', 'this gate exercises the deployed Three renderer ownership contract');
let source = await fs.readFile(sourceURL, 'utf8');
if (process.argv.includes('--break')) {
  const start = source.indexOf('      if(proxyMap===map){', source.indexOf('    function onContextLost(){'));
  const end = source.indexOf('\n      }', start);
  assert(start >= 0 && end > start, 'negative control must remove the actual proxy-loss release');
  source = source.slice(0, start) + source.slice(end + '\n      }'.length);
}

class TestGL {
  constructor() {
    Object.assign(this, { ARRAY_BUFFER: 34962, FLOAT: 5126, TEXTURE_2D: 3553,
      TEXTURE_BINDING_2D: 32873, MAX_TEXTURE_IMAGE_UNITS: 34930,
      RGBA: 6408, UNSIGNED_BYTE: 5121, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, NEAREST: 9728 });
    this.epoch = 0; this.lost = false; this.buffers = []; this.deletes = []; this.textures = []; this.boundTexture = null;
  }
  isContextLost() { return this.lost; }
  createBuffer() { assert(!this.lost); const value = { epoch: this.epoch }; this.buffers.push(value); return value; }
  bindBuffer() { assert(!this.lost, 'lost contexts cannot upload proxy buffers'); }
  bufferData() {}
  deleteBuffer(buffer) {
    this.deletes.push({ epoch: this.epoch, createdEpoch: buffer.epoch, lost: this.lost });
    // WebGL drops delete calls while lost. Once restored, an old handle is an
    // INVALID_OPERATION even though the JavaScript context object is the same.
    if (!this.lost) assert.equal(buffer.epoch, this.epoch, 'INVALID_OPERATION: deleteBuffer: object does not belong to this context');
  }
  getParameter(name) { return name === this.MAX_TEXTURE_IMAGE_UNITS ? 16 : this.boundTexture; }
  createTexture() { assert(!this.lost); const value = { epoch: this.epoch }; this.textures.push(value); return value; }
  bindTexture(target, texture) { this.boundTexture = texture; }
  texImage2D() {}
  texParameteri() {}
  deleteTexture(texture) { assert(!this.lost); assert.equal(texture.epoch, this.epoch, 'fallback deletion belongs to the current context'); }
  shaderSource() {}
  compileShader() {}
  linkProgram() {}
  getUniformLocation() {}
  useProgram() {}
  uniformMatrix4fv() {}
  drawElements() {}
  drawArrays() {}
}

class TestMap extends EventEmitter {
  constructor(gl) { super(); this.gl = gl; this.styleAvailable = true; this.painter = this.makePainter(); }
  makePainter() { return { context: { gl: this.gl }, drawFunctions: { fillExtrusion() {}, circle() {} } }; }
  addImage() {}
  updateImage() {}
  isMoving() { return false; }
  getStyle() { return this.styleAvailable ? { layers: [] } : undefined; }
  getSource() { return undefined; }
  triggerRepaint() {}
}

const gl = new TestGL(), map = new TestMap(gl), timers = new Map();
let serial = 0;
const context = vm.createContext({ THREE, console,
  slopes: { toLocal: (x, y) => ({ x, y }) },
  setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
});
context.window = context;
vm.runInContext(source, context, { filename: 'js/city-lighting.js' });
const lighting = context.CityLighting;
lighting.install(map);
const buildings = [{ type: 'Feature', properties: { id: 'ordinary-building', h: 20 },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [8, 0], [8, 5], [0, 5], [0, 0]]] } }];
lighting.setBuildings(buildings);
const tick = () => { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); };
const build = () => { lighting.shadowProxy(map); tick(); return lighting.shadowProxy(map); };
function upload(mesh) {
  const attributes = WebGLAttributes(gl, { isWebGL2: true });
  const info = { memory: { geometries: 0 }, render: { frame: 1 } };
  const geometries = WebGLGeometries(gl, attributes, info, { releaseStatesOfGeometry() {} });
  const objects = WebGLObjects(gl, geometries, attributes, info);
  objects.update(mesh);
  return { attributes, objects, info };
}

let mesh = build(), owner = upload(mesh);
assert(mesh.geometry.attributes.position.array.length > 0, 'exercise a nonempty, actually uploaded proxy');
const originalPositions = [...mesh.geometry.attributes.position.array];
for (let cycle = 0; cycle < 2; cycle++) {
  const previous = mesh, previousOwner = owner, attribute = previous.geometry.attributes.position;
  assert(previousOwner.attributes.get(attribute), 'the current renderer owns the uploaded attribute');
  lighting.setBuildings(buildings); lighting.shadowProxy(map);
  assert.equal(timers.size, 1, 'a proxy replacement is pending before context loss');
  gl.lost = true; gl.boundTexture = null; map.styleAvailable = false;
  // MapLibre destroys the old custom layer before firing its map loss event.
  // This real r159 disposal clears per-frame tracking, not geometry listeners.
  previousOwner.objects.dispose();
  map.emit('webglcontextlost');
  const timersAfterLoss = timers.size;
  const retainedAfterLoss = previousOwner.attributes.get(attribute);
  gl.epoch++; gl.lost = false; map.painter = map.makePainter(); map.emit('webglcontextrestored');
  const absentStyleProxy = build();
  map.styleAvailable = true;
  // The preserved pre-fix source fails HERE with the same old-buffer delete
  // as the real browser trace, rather than only a synthetic state assertion.
  mesh = build();
  assert.equal(timersAfterLoss, 0, 'loss cancels a deferred rebuild before it can cross context generations');
  assert.equal(retainedAfterLoss, undefined, 'loss releases the old renderer buffer owner');
  assert.equal(previousOwner.info.memory.geometries, 0);
  assert.equal(absentStyleProxy, null, 'the old proxy is discarded until the restored style is ready');
  assert.notEqual(mesh, previous);
  assert.deepEqual([...mesh.geometry.attributes.position.array], originalPositions, 'recovery preserves the exact source shadow volume');
  assert.deepEqual([...attribute.array], originalPositions, 'resource disposal did not mutate source geometry bytes');
  owner = upload(mesh);
}

lighting.setBuildings(buildings); mesh = build();
assert.equal(owner.info.memory.geometries, 0, 'ordinary live replacement still releases the preceding proxy');
owner = upload(mesh);
lighting.setBuildings(buildings); lighting.shadowProxy(map);
assert.equal(timers.size, 1);
assert.equal(lighting.stats.shadowProxyTriangles, 10, 'the final live proxy retained its expected triangles');
map.emit('remove');
assert.equal(timers.size, 0, 'map removal cancels deferred proxy work');
assert.equal(owner.info.memory.geometries, 0, 'map removal releases the current buffer owner');
assert.equal(gl.deletes.filter(item => item.lost).length, 2, 'both old owners are released during their own loss');
assert.equal(gl.deletes.filter(item => !item.lost).length, 2, 'normal replacement and removal still delete valid buffers');
assert.equal(map.listenerCount('webglcontextlost'), 0);
assert.equal(map.listenerCount('webglcontextrestored'), 0);
const textureCount = gl.textures.length;
map.emit('webglcontextrestored'); tick();
assert.equal(gl.textures.length, textureCount, 'late restoration cannot revive the removed adapter');
assert.deepEqual(Array.from(lighting.stats.failures), []);
console.log('PASS CityLighting proxy releases real r159 buffer owners during two losses; restored and normal replacements retain exact volume; removal drains resources and timers');
